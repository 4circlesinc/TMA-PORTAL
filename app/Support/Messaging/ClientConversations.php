<?php

namespace App\Support\Messaging;

use App\Models\CipApplication;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Conversations that belong on a client record.
 *
 * The Message button on an applicant is not a generic DM. Staff usually need
 * to talk to the service provider *about* the applicant, and only sometimes
 * to the person themselves — and only then if that person has a portal login.
 *
 * The case thread is one group per client: named for the applicant, members
 * are the officer who opened it plus everyone at the provider firm who can
 * sign in. Opening it again, including from another officer, joins that same
 * history rather than starting a parallel chat. Private DMs stay the ordinary
 * one-to-one thread, tagged so they also appear on the applicant's profile.
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
                'client:id,uid,name',
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
        abort_unless(Role::isStaff($actor), 403, 'Only staff can open a conversation from a client record.');

        return match ($with) {
            self::WITH_PROVIDER => self::openProvider($client, $actor),
            self::WITH_PERSON => self::openPerson($client, $actor),
            default => throw ValidationException::withMessages([
                'with' => 'Choose who to message.',
            ]),
        };
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

        return [
            'provider' => $provider,
            'person' => $person,
        ];
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

        return DB::transaction(function () use ($client, $actor, $company, $members, $application) {
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
                    'last_message_at' => now(),
                ]);

                $conversation->participants()->create([
                    'user_id' => $actor->id,
                    'role' => ConversationParticipant::ROLE_ADMIN,
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

                self::ensureMember($conversation, $actor, ConversationParticipant::ROLE_ADMIN);
                foreach ($members as $member) {
                    self::ensureMember($conversation, $member, ConversationParticipant::ROLE_MEMBER);
                }
            }

            return $conversation->fresh([
                'activeParticipants.user.presence',
                'client:id,uid,name',
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

        return DB::transaction(function () use ($client, $actor, $other) {
            $existing = Conversation::query()
                ->where('type', Conversation::TYPE_DIRECT)
                ->whereHas('participants', fn ($q) => $q->where('user_id', $actor->id)->whereNull('left_at'))
                ->whereHas('participants', fn ($q) => $q->where('user_id', $other->id)->whereNull('left_at'))
                ->lockForUpdate()
                ->first();

            if ($existing) {
                if ($existing->client_id === null) {
                    $existing->forceFill([
                        'client_id' => $client->id,
                        'subject' => Conversation::SUBJECT_PERSON,
                    ])->save();
                }

                return $existing->fresh([
                    'activeParticipants.user.presence',
                    'client:id,uid,name',
                    'company:id,uid,name',
                    'messages' => fn ($q) => $q->latest('id')->limit(1),
                ]);
            }

            $conversation = Conversation::create([
                'type' => Conversation::TYPE_DIRECT,
                'created_by' => $actor->id,
                'client_id' => $client->id,
                'subject' => Conversation::SUBJECT_PERSON,
                'last_message_at' => now(),
            ]);

            foreach ([$actor, $other] as $member) {
                $conversation->participants()->create([
                    'user_id' => $member->id,
                    'role' => ConversationParticipant::ROLE_MEMBER,
                    'joined_at' => now(),
                ]);
            }

            return $conversation->fresh([
                'activeParticipants.user.presence',
                'client:id,uid,name',
                'company:id,uid,name',
                'messages' => fn ($q) => $q->latest('id')->limit(1),
            ]);
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

    /** @param  array<string, mixed>  $detail */
    private static function systemMessage(Conversation $conversation, string $event, array $detail = []): void
    {
        $message = $conversation->messages()->create([
            'user_id' => null,
            'type' => Message::TYPE_SYSTEM,
            'system_event' => array_merge(['event' => $event], $detail),
        ]);

        $conversation->forceFill(['last_message_at' => $message->created_at])->save();
    }
}
