<?php

namespace App\Support\Messaging;

use App\Events\CipThreadChanged;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Models\CallRecording;
use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipApplicationMessage;
use App\Models\CipApplicationMessageRead;
use App\Models\CipApplicationMessageReceipt;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\FolderAccess;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Conversations that belong on a client record.
 *
 * The Message button on an applicant is not a generic DM. Staff usually need
 * to talk to the service provider *about* the applicant, and only sometimes
 * to the person themselves, and only then if that person has a portal login.
 *
 * The case thread is one group per client: named for the applicant, members
 * are the officer who opened it plus everyone at the provider firm who can
 * sign in. Opening it again, including from another officer, joins that same
 * history rather than starting a parallel chat. Private DMs stay the ordinary
 * one-to-one thread, tagged so they also appear on the applicant's profile.
 *
 * History follows the client (and the provider firm), not the current login.
 * A contact who is purged and invited again, or a colleague at the same firm
 * who creates an account, is put back in those threads so the messages and
 * call recordings on the file stay reachable.
 */
class ClientConversations
{
    public const WITH_PROVIDER = 'provider';

    public const WITH_PERSON = 'person';

    /**
     * Who this officer may message from the applicant, and the threads already
     * on the file.
     *
     * @return array{options: array<string, mixed>, conversations: array<int, array<string, mixed>>}
     */
    public static function index(Client $client, User $viewer): array
    {
        $options = self::options($client, $viewer);

        $conversations = Conversation::query()
            ->where('client_id', $client->id)
            ->where(function ($q) use ($viewer) {
                $q->where('subject', Conversation::SUBJECT_PROVIDER)
                    ->orWhereHas('participants', function ($participants) use ($viewer) {
                        $participants->where('user_id', $viewer->id)->whereNull('left_at');
                    });
            })
            ->with([
                'activeParticipants.user.presence',
                'client:id,uid,name,photo_url',
                'company:id,uid,name',
                'messages' => fn ($q) => $q->latest('id')->limit(1),
            ])
            ->orderByDesc('last_message_at')
            ->get()
            ->map(fn (Conversation $conversation) => MessagingPresenter::conversation($conversation, $viewer))
            ->values()
            ->all();

        return [
            'options' => $options,
            'conversations' => $conversations,
        ];
    }

    /**
     * Open (or reuse) the thread this button asked for.
     */
    public static function open(Client $client, User $actor, string $with): Conversation
    {
        /*
         * The provider side opens the same case thread, from their own side of
         * it. It is one group per file — staff and the firm in one room — so a
         * provider starting the conversation must join that thread rather than
         * begin a parallel one, and the firm is talking to them either way.
         *
         * Only the provider lane, though: a private DM with the applicant is
         * the firm's to start.
         */
        if (! Role::isStaff($actor)) {
            abort_unless(
                $with === self::WITH_PROVIDER && self::isProviderContactFor($client, $actor),
                403,
                'Only staff can open a conversation from a client record.'
            );
        }

        return match ($with) {
            self::WITH_PROVIDER => self::openProvider($client, $actor),
            self::WITH_PERSON => self::openPerson($client, $actor),
            default => throw ValidationException::withMessages([
                'with' => 'Choose who to message.',
            ]),
        };
    }

    /**
     * Is this account an active contact at the firm this applicant belongs to?
     *
     * Asked of THIS client's provider, not of provider-ness in general: a
     * contact at one firm has no business opening a thread about another
     * firm's applicant.
     */
    private static function isProviderContactFor(Client $client, User $user): bool
    {
        $company = self::providerCompany($client);

        if (! $company) {
            return false;
        }

        return CompanyMember::query()
            ->active()
            ->where('company_id', $company->id)
            ->where('user_id', $user->id)
            ->exists();
    }

    /**
     * @return array{provider: array<string, mixed>, person: array<string, mixed>}
     */
    public static function options(Client $client, User $viewer): array
    {
        $company = self::providerCompany($client);
        $contacts = $company ? self::providerContacts($company) : collect();
        $reachable = $contacts->filter(fn (User $u) => $u->isApproved());

        $provider = [
            'available' => $reachable->isNotEmpty(),
            'companyName' => $company?->name,
            'companyId' => $company?->uid,
            'accountCount' => $reachable->count(),
            'contacts' => $contacts->map(fn (User $u) => [
                'name' => $u->name,
                'hasAccount' => $u->isApproved(),
            ])->values()->all(),
        ];

        if (! $company) {
            $provider['reason'] = 'This applicant isn’t linked to a service provider.';
        } elseif ($reachable->isEmpty()) {
            $provider['reason'] = 'No one at '.$company->name.' has a portal login yet.';
        }

        $person = [
            'available' => $client->user_id !== null,
            'name' => $client->name,
        ];

        if (! $person['available']) {
            $person['reason'] = $client->name.' doesn’t have a portal login yet.';
        }

        /*
         * The provider side reads the same options from their own side of the
         * thread. "Message the service provider" is the firm's sentence, not
         * theirs — they ARE the provider — and the private DM with the
         * applicant is the firm's to start, so it is not offered.
         *
         * Their one destination stays available even when nobody at the firm
         * has a login besides themselves: they are the login, and the group
         * they are opening is with the firm handling the file.
         */
        if (! Role::isStaff($viewer)) {
            return [
                'provider' => [
                    'available' => true,
                    'companyName' => null,
                    'companyId' => $company?->uid,
                    'accountCount' => $provider['accountCount'],
                    'contacts' => [],
                    'viewerIsProvider' => true,
                ],
                'person' => ['available' => false],
            ];
        }

        return [
            'provider' => $provider,
            'person' => $person,
        ];
    }

    /**
     * Who at the firm belongs in the case thread, whoever opened it.
     *
     * Every administrator, plus the officers actually holding the file.
     * A provider message on the application is correspondence for that
     * whole group, so it has to be in their inbox without any one of them
     * having clicked Message first. The person who opened it is added by
     * the caller when they are not already in this set.
     *
     * @return Collection<int, User>
     */
    private static function firmSideFor(Client $client): Collection
    {
        $admins = User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', User::STATUS_APPROVED)
            ->get();

        $applicationIds = CipApplication::query()
            ->where('client_id', $client->id)
            ->select('id');

        // whereIn + subquery, the ClientScope convention: the assignment index
        // answers directly rather than a correlated EXISTS per user row.
        // The hub assignment and the CIP assignment are the same hold, written
        // from either screen; a file named on only one of them still counts.
        $officers = User::query()
            ->where('status', User::STATUS_APPROVED)
            ->where(function ($query) use ($client, $applicationIds) {
                $query->whereIn('id', ClientAssignment::query()
                    ->select('user_id')
                    ->live()
                    ->where('client_id', $client->id))
                    ->orWhereIn('id', CipApplicationAssignment::query()
                        ->select('user_id')
                        ->live()
                        ->whereIn('application_id', $applicationIds));
            })
            ->get();

        return $admins->concat($officers)->unique('id')->values();
    }

    private static function openProvider(Client $client, User $actor): Conversation
    {
        $company = self::providerCompany($client);
        if (! $company) {
            throw ValidationException::withMessages([
                'with' => 'This applicant isn’t linked to a service provider.',
            ]);
        }

        $members = self::providerContacts($company)->filter(fn (User $u) => $u->isApproved());
        if ($members->isEmpty()) {
            throw ValidationException::withMessages([
                'with' => 'No one at '.$company->name.' has a portal login yet.',
            ]);
        }

        $application = self::applicationFor($client);
        $staff = self::firmSideFor($client);

        return DB::transaction(function () use ($client, $actor, $company, $members, $application, $staff) {
            $conversation = Conversation::query()
                ->where('client_id', $client->id)
                ->where('subject', Conversation::SUBJECT_PROVIDER)
                ->lockForUpdate()
                ->first();

            if (! $conversation) {
                $conversation = Conversation::create([
                    'type' => Conversation::TYPE_GROUP,
                    'name' => $client->name,
                    'description' => 'Conversation with '.$company->name.' about '.$client->name,
                    'created_by' => $actor->id,
                    'client_id' => $client->id,
                    'company_id' => $company->id,
                    'cip_application_id' => $application?->id,
                    'subject' => Conversation::SUBJECT_PROVIDER,
                ]);

                $conversation->participants()->create([
                    'user_id' => $actor->id,
                    'role' => Role::isStaff($actor)
                        ? ConversationParticipant::ROLE_ADMIN
                        : ConversationParticipant::ROLE_MEMBER,
                    'joined_at' => now(),
                ]);

                foreach ($members as $member) {
                    if ($member->id === $actor->id) {
                        continue;
                    }
                    $conversation->participants()->create([
                        'user_id' => $member->id,
                        'role' => ConversationParticipant::ROLE_MEMBER,
                        'joined_at' => now(),
                    ]);
                }

                /*
                 * A thread the provider side opened still needs the firm in
                 * it, or they are writing to an empty room: staff join by
                 * being assigned or by being an administrator, never by
                 * having clicked Message first.
                 */
                foreach ($staff as $member) {
                    if ($member->id === $actor->id) {
                        continue;
                    }
                    self::ensureMember($conversation, $member, ConversationParticipant::ROLE_ADMIN);
                }

                self::systemMessage($conversation, 'case_opened', [
                    'actorName' => $actor->name,
                    'clientName' => $client->name,
                    'companyName' => $company->name,
                ]);
            } else {
                $conversation->forceFill([
                    'name' => $client->name,
                    'company_id' => $company->id,
                    'cip_application_id' => $application?->id ?? $conversation->cip_application_id,
                ])->save();

                self::ensureMember(
                    $conversation,
                    $actor,
                    Role::isStaff($actor)
                        ? ConversationParticipant::ROLE_ADMIN
                        : ConversationParticipant::ROLE_MEMBER
                );
                foreach ($members as $member) {
                    self::ensureMember($conversation, $member, ConversationParticipant::ROLE_MEMBER);
                }
                foreach ($staff as $member) {
                    self::ensureMember($conversation, $member, ConversationParticipant::ROLE_ADMIN);
                }
            }

            // The file already has the provider conversation. The group should
            // open on that history, not on an empty room.
            self::syncProviderFile($conversation);

            return $conversation->fresh([
                'activeParticipants.user.presence',
                'client:id,uid,name,photo_url',
                'company:id,uid,name',
                'messages' => fn ($q) => $q->latest('id')->limit(1),
            ]);
        });
    }

    private static function openPerson(Client $client, User $actor): Conversation
    {
        if (! $client->user_id) {
            throw ValidationException::withMessages([
                'with' => $client->name.' doesn’t have a portal login yet.',
            ]);
        }

        $other = User::query()
            ->where('id', $client->user_id)
            ->where('status', User::STATUS_APPROVED)
            ->first();

        if (! $other) {
            throw ValidationException::withMessages([
                'with' => $client->name.' doesn’t have a portal login yet.',
            ]);
        }

        if ($other->id === $actor->id) {
            throw ValidationException::withMessages([
                'with' => 'You cannot message yourself.',
            ]);
        }

        return self::resolveDirect($actor, $other, $client);
    }

    /**
     * Open (or reuse) a 1:1, tagging it onto the client when one of the people
     * is that client's login. Staff messaging a replacement login land in the
     * same thread they had with the previous account.
     */
    public static function resolveDirect(User $user, User $other, ?Client $client = null): Conversation
    {
        $client ??= self::clientBetween($user, $other);

        return DB::transaction(function () use ($user, $other, $client) {
            $existing = Conversation::query()
                ->where('type', Conversation::TYPE_DIRECT)
                ->whereHas('participants', fn ($q) => $q->where('user_id', $user->id)->whereNull('left_at'))
                ->whereHas('participants', fn ($q) => $q->where('user_id', $other->id)->whereNull('left_at'))
                ->lockForUpdate()
                ->first();

            if ($existing) {
                self::tagDirect($existing, $client);

                return self::freshDirect($existing);
            }

            $staff = Role::isStaff($user) ? $user : (Role::isStaff($other) ? $other : null);
            if ($client && $staff) {
                $orphaned = Conversation::query()
                    ->where('type', Conversation::TYPE_DIRECT)
                    ->where('client_id', $client->id)
                    ->where(fn ($q) => $q->where('subject', Conversation::SUBJECT_PERSON)->orWhereNull('subject'))
                    ->whereHas('participants', fn ($q) => $q->where('user_id', $staff->id)->whereNull('left_at'))
                    ->lockForUpdate()
                    ->first();

                if ($orphaned) {
                    self::ensureMember($orphaned, $user, ConversationParticipant::ROLE_MEMBER);
                    self::ensureMember($orphaned, $other, ConversationParticipant::ROLE_MEMBER);
                    self::tagDirect($orphaned, $client);

                    return self::freshDirect($orphaned);
                }
            }

            $conversation = Conversation::create([
                'type' => Conversation::TYPE_DIRECT,
                'created_by' => $user->id,
                'client_id' => $client?->id,
                'subject' => $client ? Conversation::SUBJECT_PERSON : null,
            ]);

            foreach ([$user, $other] as $member) {
                $conversation->participants()->create([
                    'user_id' => $member->id,
                    'role' => ConversationParticipant::ROLE_MEMBER,
                    'joined_at' => now(),
                ]);
            }

            return self::freshDirect($conversation);
        });
    }

    /**
     * Put this login into the threads that belong on their client file.
     *
     * The applicant's current account joins every private DM tagged on that
     * client. A provider-firm contact joins every case thread their firm
     * already has about those applicants, including ones opened before they
     * had an account.
     */
    public static function attachLogin(User $user): void
    {
        // An administrator, the officer holding the file, or the provider
        // firm should already be in the case thread before the inbox is
        // drawn, including messages that landed before they had a login.
        self::provisionCaseThreads($user);

        $clientIds = Client::query()->where('user_id', $user->id)->pluck('id');

        if ($clientIds->isNotEmpty()) {
            Conversation::query()
                ->whereIn('client_id', $clientIds)
                ->where(function ($q) {
                    $q->where('subject', Conversation::SUBJECT_PERSON)
                        ->orWhere(fn ($w) => $w->where('type', Conversation::TYPE_DIRECT)->whereNull('subject'));
                })
                ->get()
                ->each(fn (Conversation $conversation) => self::ensureMember(
                    $conversation, $user, ConversationParticipant::ROLE_MEMBER
                ));

            CallRecording::query()
                ->whereIn('client_id', $clientIds)
                ->update(['client_user_id' => $user->id]);
        }

        $companyIds = CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->pluck('company_id');

        if ($companyIds->isEmpty()) {
            return;
        }

        $firmClientIds = FolderAccess::clientIdsFor($user);

        Conversation::query()
            ->where('subject', Conversation::SUBJECT_PROVIDER)
            ->where(function ($q) use ($companyIds, $firmClientIds) {
                $q->whereIn('company_id', $companyIds);
                if ($firmClientIds !== []) {
                    $q->orWhereIn('client_id', $firmClientIds);
                }
            })
            ->get()
            ->each(fn (Conversation $conversation) => self::ensureMember(
                $conversation, $user, ConversationParticipant::ROLE_MEMBER
            ));
    }

    /**
     * Stamp client/company on threads this login is in, so a purge that drops
     * their participant row still leaves a file to reattach the next account.
     */
    public static function preserveForLogin(User $user): void
    {
        $conversationIds = ConversationParticipant::query()
            ->where('user_id', $user->id)
            ->whereNull('left_at')
            ->pluck('conversation_id');

        if ($conversationIds->isEmpty()) {
            return;
        }

        $clientId = Client::query()->where('user_id', $user->id)->value('id');
        $companyId = CompanyMember::query()->where('user_id', $user->id)->value('company_id');

        Conversation::query()
            ->whereIn('id', $conversationIds)
            ->get()
            ->each(function (Conversation $conversation) use ($clientId, $companyId) {
                $patch = [];

                if ($clientId && $conversation->type === Conversation::TYPE_DIRECT && $conversation->client_id === null) {
                    $patch['client_id'] = $clientId;
                    $patch['subject'] = Conversation::SUBJECT_PERSON;
                }

                if ($companyId && $conversation->company_id === null && $conversation->subject === Conversation::SUBJECT_PROVIDER) {
                    $patch['company_id'] = $companyId;
                }

                if ($patch !== []) {
                    $conversation->forceFill($patch)->save();
                }
            });
    }

    /**
     * The firm to talk to about this applicant: the CIP provider's company
     * when there is an application, otherwise the client hub's own link.
     */
    public static function providerCompany(Client $client): ?Company
    {
        $application = self::applicationFor($client);
        $fromProvider = $application?->provider?->company;
        if ($fromProvider) {
            return $fromProvider;
        }

        $client->loadMissing('companyRecord');

        return $client->companyRecord;
    }

    private static function applicationFor(Client $client): ?CipApplication
    {
        return CipApplication::query()
            ->with('provider.company')
            ->where('client_id', $client->id)
            ->latest('id')
            ->first();
    }

    /** @return Collection<int, User> */
    private static function providerContacts(Company $company): Collection
    {
        return CompanyMember::query()
            ->active()
            ->where('company_id', $company->id)
            ->with('user')
            ->get()
            ->map(fn (CompanyMember $member) => $member->user)
            ->filter()
            ->unique('id')
            ->values();
    }

    private static function clientBetween(User $user, User $other): ?Client
    {
        return Client::query()
            ->whereIn('user_id', [$user->id, $other->id])
            ->first();
    }

    private static function tagDirect(Conversation $conversation, ?Client $client): void
    {
        if (! $client || $conversation->client_id !== null) {
            return;
        }

        $conversation->forceFill([
            'client_id' => $client->id,
            'subject' => Conversation::SUBJECT_PERSON,
        ])->save();
    }

    private static function freshDirect(Conversation $conversation): Conversation
    {
        return $conversation->fresh([
            'activeParticipants.user.presence',
            'client:id,uid,name,photo_url',
            'company:id,uid,name',
            'messages' => fn ($q) => $q->latest('id')->limit(1),
        ]) ?? $conversation;
    }

    private static function ensureMember(Conversation $conversation, User $user, string $role): void
    {
        $existing = $conversation->participants()->where('user_id', $user->id)->first();

        if ($existing && $existing->left_at === null) {
            return;
        }

        if ($existing) {
            $existing->forceFill([
                'left_at' => null,
                'joined_at' => now(),
                'role' => $role === ConversationParticipant::ROLE_ADMIN
                    ? ConversationParticipant::ROLE_ADMIN
                    : $existing->role,
            ])->save();

            return;
        }

        $conversation->participants()->create([
            'user_id' => $user->id,
            'role' => $role,
            'joined_at' => now(),
        ]);
    }

    /**
     * Copy the file's messages into this case group.
     *
     * Internal notes are copied and tagged, so staff see them and the
     * service provider does not. A message already copied is left where it
     * is, so opening the group again does not repeat it. A copy is unread
     * in the inbox until that person has read it, on the file or here.
     * Reading it here is what clears it on the application.
     */
    public static function syncProviderFile(Conversation $conversation, ?User $except = null): void
    {
        $applicationId = $conversation->cip_application_id;

        if (! $applicationId && $conversation->client_id) {
            $client = $conversation->relationLoaded('client')
                ? $conversation->client
                : Client::query()->find($conversation->client_id);
            $applicationId = $client ? self::applicationFor($client)?->id : null;
        }

        if (! $applicationId) {
            return;
        }

        $hadCorrespondence = $conversation->messages()
            ->where('type', '!=', Message::TYPE_SYSTEM)
            ->exists();

        $rows = CipApplicationMessage::query()
            ->where('application_id', $applicationId)
            ->orderBy('id')
            ->get();

        foreach ($rows as $row) {
            self::copyProviderMessage($conversation, $row, false);
        }

        self::alignFileReads($conversation);
        self::touchLastMessage($conversation);

        // The first real copy is what puts the thread in the inbox. People
        // are not subscribed to a conversation they have never been shown.
        // A thread that so far holds only internal notes is staff's to see.
        $hasCopy = $conversation->messages()->where('type', '!=', Message::TYPE_SYSTEM)->exists();
        $providerCanSee = $conversation->messages()
            ->where('type', '!=', Message::TYPE_SYSTEM)
            ->where(fn ($query) => $query->whereNull('lane')->orWhere('lane', '!=', Message::LANE_INTERNAL))
            ->exists();

        if (! $hadCorrespondence && $hasCopy) {
            MessageNotifier::surfaceInInbox($conversation, $except, ! $providerCanSee);
        }
    }

    /**
     * A service-provider message just landed on the file.
     *
     * The case group is created if nobody has opened Message yet, with every
     * administrator and the officers holding the file already in it, and the
     * copy is unread for anyone who has not read that line on the application.
     */
    public static function mirrorProviderMessage(CipApplicationMessage $message): void
    {
        if (! in_array($message->lane, CipApplicationMessage::LANES, true)) {
            return;
        }

        $message->loadMissing('application.client', 'author');
        $application = $message->application;
        $client = $application?->client;

        if (! $application || ! $client) {
            return;
        }

        $alreadyCopied = Message::query()
            ->where('cip_application_message_id', $message->id)
            ->exists();

        $conversation = self::openCaseRecord($client, $application, $message->author);
        self::syncProviderFile($conversation, $message->author);

        if ($alreadyCopied) {
            return;
        }

        $copy = Message::query()
            ->where('cip_application_message_id', $message->id)
            ->first();

        if (! $copy) {
            return;
        }

        $copy->setRelation('conversation', $conversation);
        Broadcaster::to(new MessageSent($copy));
    }

    /**
     * Put this person in the case thread, when the file already has one.
     *
     * Assigning an officer after the conversation exists is the same join as
     * opening Message: the history is there, and lines they have not read on
     * the application stay unread in the inbox.
     */
    public static function joinCaseThread(Client $client, User $user): void
    {
        if ($user->status !== User::STATUS_APPROVED) {
            return;
        }

        $conversation = Conversation::query()
            ->where('client_id', $client->id)
            ->where('subject', Conversation::SUBJECT_PROVIDER)
            ->first();

        if (! $conversation) {
            return;
        }

        self::ensureMember(
            $conversation,
            $user,
            Role::isStaff($user)
                ? ConversationParticipant::ROLE_ADMIN
                : ConversationParticipant::ROLE_MEMBER
        );
        self::alignFileReads($conversation);
    }

    /**
     * A correction on the file replaces the copy in the case chat.
     */
    public static function reflectFileEdit(CipApplicationMessage $message): void
    {
        Message::query()
            ->where('cip_application_message_id', $message->id)
            ->get()
            ->each(function (Message $copy) use ($message) {
                $copy->forceFill([
                    'body' => $message->body,
                    'edited_at' => $message->edited_at,
                ])->save();
                $copy->load('conversation');

                if ($copy->conversation) {
                    Broadcaster::to(new MessageUpdated($copy));
                }
            });
    }

    /**
     * A correction in the case chat replaces the file message it was copied from.
     */
    public static function reflectChatEdit(Message $message): void
    {
        if (! $message->cip_application_message_id) {
            return;
        }

        $file = CipApplicationMessage::query()->find($message->cip_application_message_id);

        if (! $file || $file->body === $message->body) {
            return;
        }

        $file->forceFill([
            'body' => $message->body,
            'edited_at' => $message->edited_at ?? now(),
        ])->save();

        $file->load('application');

        if ($file->application) {
            Broadcaster::signal(new CipThreadChanged($file->application, 'edited'));
        }
    }

    private static function copyProviderMessage(Conversation $conversation, CipApplicationMessage $source, bool $broadcast): bool
    {
        $existing = Message::query()->where('cip_application_message_id', $source->id)->first();

        if ($existing) {
            if ($existing->lane === null) {
                $existing->forceFill(['lane' => $source->lane])->save();
            }

            return false;
        }

        $replyToId = $source->reply_to_id
            ? Message::query()->where('cip_application_message_id', $source->reply_to_id)->value('id')
            : null;

        $copy = new Message([
            'conversation_id' => $conversation->id,
            'user_id' => $source->author_id,
            'type' => Message::TYPE_TEXT,
            'body' => $source->body,
            'reply_to_id' => $replyToId,
            'cip_application_message_id' => $source->id,
            'lane' => $source->lane,
        ]);
        $copy->timestamps = false;
        $copy->created_at = $source->created_at ?? now();
        $copy->updated_at = $source->updated_at ?? $copy->created_at;
        $copy->save();

        if ($broadcast) {
            $copy->setRelation('conversation', $conversation);
            Broadcaster::to(new MessageSent($copy));
        }

        return true;
    }

    /**
     * Catch the inbox up to what each person has already read on the file.
     *
     * A service-provider line they have not seen stays unread here, which is
     * the badge on Messages. Their own words, a file cursor that already
     * covers the line, or a receipt from reading it in either place, do not
     * come back as new. The cursor cannot skip a message, so it stops at the
     * first line that is still unread.
     */
    private static function alignFileReads(Conversation $conversation): void
    {
        $applicationId = $conversation->cip_application_id;

        if (! $applicationId) {
            return;
        }

        $copies = Message::query()
            ->where('conversation_id', $conversation->id)
            ->whereNotNull('cip_application_message_id')
            ->orderBy('id')
            ->get(['id', 'user_id', 'cip_application_message_id']);

        if ($copies->isEmpty()) {
            return;
        }

        $sourceIds = $copies->pluck('cip_application_message_id')->all();

        $fileCursor = CipApplicationMessageRead::query()
            ->where('application_id', $applicationId)
            ->pluck('last_read_id', 'user_id');

        $receipts = CipApplicationMessageReceipt::query()
            ->whereIn('message_id', $sourceIds)
            ->get(['message_id', 'user_id'])
            ->groupBy('user_id');

        $participants = ConversationParticipant::query()
            ->where('conversation_id', $conversation->id)
            ->whereNull('left_at')
            ->get();

        foreach ($participants as $participant) {
            $cursor = (int) ($participant->last_read_message_id ?? 0);
            $cipCursor = (int) ($fileCursor[$participant->user_id] ?? 0);
            $seen = ($receipts->get($participant->user_id) ?? collect())
                ->mapWithKeys(fn (CipApplicationMessageReceipt $row) => [(int) $row->message_id => true]);

            $pending = Message::query()
                ->where('conversation_id', $conversation->id)
                ->where('id', '>', $cursor)
                ->where('type', '!=', Message::TYPE_SYSTEM)
                ->orderBy('id')
                ->get(['id', 'user_id', 'cip_application_message_id']);

            $target = $cursor;

            foreach ($pending as $row) {
                if (! $row->cip_application_message_id) {
                    break;
                }

                $readOnFile = (int) $row->user_id === (int) $participant->user_id
                    || (int) $row->cip_application_message_id <= $cipCursor
                    || isset($seen[(int) $row->cip_application_message_id]);

                if (! $readOnFile) {
                    break;
                }

                $target = (int) $row->id;
            }

            if ($target <= $cursor) {
                continue;
            }

            $participant->forceFill([
                'last_read_message_id' => $target,
                'last_read_at' => $participant->last_read_at ?? now(),
            ])->save();
        }
    }

    /**
     * The case group for this applicant, created the first time a
     * service-provider message needs a copy in Messages.
     */
    private static function openCaseRecord(Client $client, CipApplication $application, ?User $actor): Conversation
    {
        $company = self::providerCompany($client);

        return DB::transaction(function () use ($client, $application, $actor, $company) {
            $conversation = Conversation::query()
                ->where('client_id', $client->id)
                ->where('subject', Conversation::SUBJECT_PROVIDER)
                ->lockForUpdate()
                ->first();

            if (! $conversation) {
                $conversation = Conversation::create([
                    'type' => Conversation::TYPE_GROUP,
                    'name' => $client->name,
                    'description' => $company
                        ? 'Conversation with '.$company->name.' about '.$client->name
                        : 'Conversation about '.$client->name,
                    'created_by' => $actor?->id,
                    'client_id' => $client->id,
                    'company_id' => $company?->id,
                    'cip_application_id' => $application->id,
                    'subject' => Conversation::SUBJECT_PROVIDER,
                ]);

                if ($actor) {
                    self::systemMessage($conversation, 'case_opened', [
                        'actorName' => $actor->name,
                        'clientName' => $client->name,
                        'companyName' => $company?->name,
                    ]);
                }
            } else {
                $conversation->forceFill([
                    'name' => $client->name,
                    'company_id' => $company?->id ?? $conversation->company_id,
                    'cip_application_id' => $application->id ?? $conversation->cip_application_id,
                ])->save();
            }

            self::refreshProviderMembers($conversation, $client, $actor);

            return $conversation;
        });
    }

    /**
     * Administrators, the officers holding the file, the provider firm, and
     * the author when they are none of those.
     */
    private static function refreshProviderMembers(Conversation $conversation, Client $client, ?User $actor): void
    {
        $company = self::providerCompany($client);

        if ($company) {
            foreach (self::providerContacts($company)->filter(fn (User $user) => $user->isApproved()) as $member) {
                self::ensureMember($conversation, $member, ConversationParticipant::ROLE_MEMBER);
            }
        }

        foreach (self::firmSideFor($client) as $member) {
            self::ensureMember($conversation, $member, ConversationParticipant::ROLE_ADMIN);
        }

        if ($actor) {
            self::ensureMember(
                $conversation,
                $actor,
                Role::isStaff($actor)
                    ? ConversationParticipant::ROLE_ADMIN
                    : ConversationParticipant::ROLE_MEMBER
            );
        }
    }

    /**
     * Case threads this login should already be able to open.
     *
     * Administrators see every application's provider messages. An officer
     * sees the files they hold. A provider contact sees their own firm's.
     * Threads that already exist only gain the missing member; threads that
     * were never opened are created from the messages already on the file.
     */
    private static function provisionCaseThreads(User $user): void
    {
        if ($user->status !== User::STATUS_APPROVED) {
            return;
        }

        if (Role::isAdmin($user)) {
            self::createMissingCaseThreads(null);
            self::joinMissingProviderThreads($user, null);
            self::copyUnmirroredFileMessages(null);

            return;
        }

        $clientIds = [];

        if (Role::isStaff($user)) {
            $clientIds = ClientAssignment::query()
                ->live()
                ->where('user_id', $user->id)
                ->pluck('client_id')
                ->all();

            $fromFile = CipApplicationAssignment::query()
                ->live()
                ->where('user_id', $user->id)
                ->whereHas('application', fn ($query) => $query->whereNotNull('client_id'))
                ->with('application:id,client_id')
                ->get()
                ->pluck('application.client_id')
                ->filter()
                ->all();

            $clientIds = array_values(array_unique([...$clientIds, ...$fromFile]));
        }

        $companyIds = CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->pluck('company_id');

        if ($companyIds->isNotEmpty()) {
            $firmClients = CipApplication::query()
                ->whereNotNull('client_id')
                ->whereHas('provider', fn ($query) => $query->whereIn('company_id', $companyIds))
                ->pluck('client_id')
                ->all();

            $clientIds = array_values(array_unique([...$clientIds, ...$firmClients]));
        }

        if ($clientIds === []) {
            return;
        }

        self::createMissingCaseThreads($clientIds);
        self::joinMissingProviderThreads($user, $clientIds);
        self::copyUnmirroredFileMessages($clientIds);
    }

    /**
     * Messages already on a file, into a case group that already exists.
     *
     * A group opened before these lines were copied would otherwise keep
     * showing the old history. Opening Messages fills in whatever is missing,
     * and stamps the lane on copies that were written before the lane existed.
     *
     * @param  list<int>|null  $clientIds  Null is every applicant.
     */
    private static function copyUnmirroredFileMessages(?array $clientIds): void
    {
        $applicationIds = CipApplicationMessage::query()
            ->whereIn('lane', CipApplicationMessage::LANES)
            ->whereNotExists(function ($query) {
                $query->selectRaw('1')
                    ->from('messages')
                    ->whereColumn('messages.cip_application_message_id', 'cip_application_messages.id');
            })
            ->whereHas('application', function ($query) use ($clientIds) {
                $query->whereNotNull('client_id');

                if ($clientIds !== null) {
                    $query->whereIn('client_id', $clientIds);
                }
            })
            ->distinct()
            ->pluck('application_id');

        CipApplication::query()
            ->whereIn('id', $applicationIds)
            ->with(['client', 'provider.company'])
            ->get()
            ->each(function (CipApplication $application) {
                if (! $application->client) {
                    return;
                }

                $conversation = self::openCaseRecord($application->client, $application, null);
                self::syncProviderFile($conversation);
            });

        self::stampCopiedLanes($clientIds);
    }

    /**
     * @param  list<int>|null  $clientIds
     */
    private static function stampCopiedLanes(?array $clientIds): void
    {
        $copies = Message::query()
            ->whereNull('lane')
            ->whereNotNull('cip_application_message_id')
            ->when($clientIds !== null, function ($query) use ($clientIds) {
                $query->whereHas('conversation', fn ($conversation) => $conversation->whereIn('client_id', $clientIds));
            })
            ->get(['id', 'cip_application_message_id']);

        if ($copies->isEmpty()) {
            return;
        }

        $lanes = CipApplicationMessage::query()
            ->whereIn('id', $copies->pluck('cip_application_message_id'))
            ->pluck('lane', 'id');

        foreach ($copies as $copy) {
            $lane = $lanes[$copy->cip_application_message_id] ?? null;

            if (! in_array($lane, CipApplicationMessage::LANES, true)) {
                continue;
            }

            $copy->forceFill(['lane' => $lane])->save();
        }
    }

    /**
     * @param  list<int>|null  $clientIds  Null is every applicant.
     */
    private static function createMissingCaseThreads(?array $clientIds): void
    {
        $existing = Conversation::query()
            ->where('subject', Conversation::SUBJECT_PROVIDER)
            ->whereNotNull('client_id')
            ->when($clientIds !== null, fn ($query) => $query->whereIn('client_id', $clientIds))
            ->pluck('client_id');

        $applications = CipApplication::query()
            ->whereNotNull('client_id')
            ->when($clientIds !== null, fn ($query) => $query->whereIn('client_id', $clientIds))
            ->when($existing->isNotEmpty(), fn ($query) => $query->whereNotIn('client_id', $existing))
            ->whereHas('messages')
            ->with(['client', 'provider.company'])
            ->orderByDesc('id')
            ->get()
            ->unique('client_id');

        foreach ($applications as $application) {
            if (! $application->client) {
                continue;
            }

            $conversation = self::openCaseRecord($application->client, $application, null);
            self::syncProviderFile($conversation);
        }
    }

    /**
     * @param  list<int>|null  $clientIds  Null is every case thread.
     */
    private static function joinMissingProviderThreads(User $user, ?array $clientIds): void
    {
        $role = Role::isStaff($user)
            ? ConversationParticipant::ROLE_ADMIN
            : ConversationParticipant::ROLE_MEMBER;

        Conversation::query()
            ->where('subject', Conversation::SUBJECT_PROVIDER)
            ->when($clientIds !== null, fn ($query) => $query->whereIn('client_id', $clientIds))
            ->whereDoesntHave('participants', function ($query) use ($user) {
                $query->where('user_id', $user->id)->whereNull('left_at');
            })
            ->get()
            ->each(function (Conversation $conversation) use ($user, $role) {
                self::ensureMember($conversation, $user, $role);
                self::alignFileReads($conversation);
            });
    }

    private static function touchLastMessage(Conversation $conversation): void
    {
        $latest = $conversation->messages()
            ->where('type', '!=', Message::TYPE_SYSTEM)
            ->max('created_at');

        if ($latest === null) {
            return;
        }

        if ($conversation->last_message_at === null || $conversation->last_message_at->lt($latest)) {
            $conversation->forceFill(['last_message_at' => $latest])->save();
        }
    }

    /** @param  array<string, mixed>  $detail */
    private static function systemMessage(Conversation $conversation, string $event, array $detail = []): void
    {
        $message = $conversation->messages()->create([
            'user_id' => null,
            'type' => Message::TYPE_SYSTEM,
            'system_event' => array_merge(['event' => $event], $detail),
        ]);

        // A "case opened" line is history on the file, not correspondence.
        // Stamping last_message_at here would float the empty thread to the
        // top of every member's inbox as if someone had written.
        if ($event !== 'case_opened') {
            $conversation->forceFill(['last_message_at' => $message->created_at])->save();
        }
    }
}
