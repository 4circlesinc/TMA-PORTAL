<?php

namespace App\Support\Messaging;

use App\Events\InboxUpdated;
use App\Events\MessageSent;
use App\Models\Message;
use App\Models\Template;
use App\Models\User;
use App\Models\UserBlock;
use App\Support\Access\Role;
use App\Support\Templates\Markup;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * The message a new person finds in their inbox, from the administrator the
 * firm chose to greet them (Templates > Welcome Message).
 *
 * It is an ordinary direct message from that administrator, not a system
 * line: it lists in both inboxes, counts as unread, and the new person can
 * answer it like any other. A system message would never show at all, since
 * a direct thread holding only system lines is not listed.
 *
 * Sent once per account, at its first activation, whichever door that comes
 * through (approval, an accepted invitation, a reactivated denial, the
 * artisan command). `users.welcomed_at` is claimed before anything is posted,
 * and claimed whether or not the message is switched on, so switching it on
 * later never greets people who joined before it.
 *
 * Stored as one `templates` row (kind welcome-message). No row means it is
 * off and the shipped copy is offered for editing.
 */
final class WelcomeMessage
{
    public const KIND = 'welcome-message';

    public const KEY = 'portal';

    /** Well inside what a message may hold (MessagingController::send). */
    public const MAX_CHARS = 5000;

    /** Placeholder => what it is filled with, for the editor's chips. */
    public const VARIABLES = [
        'firstName' => 'Their first name',
        'name' => 'Their full name',
        'senderName' => 'Your sender’s name',
        'senderTitle' => 'Your sender’s job title',
    ];

    public const DEFAULT_BODY = <<<'TEXT'
Hi{{#firstName}} {{firstName}}{{/firstName}},

Welcome to the TM Antoine Advisory Portal! I'm {{senderName}}{{#senderTitle}}, {{senderTitle}}{{/senderTitle}} at TM Antoine Partners.

If you have any questions or run into an issue with the portal, message me here and I'll be glad to help.

Again, welcome aboard!
TEXT;

    /** The preview's stand-in for whoever joins next. */
    private const SAMPLE_RECIPIENT = ['first_name' => 'Ada', 'name' => 'Ada Lovelace'];

    /**
     * What is saved, or the shipped copy switched off.
     *
     * @return array{enabled: bool, senderId: ?int, body: string, row: ?Template}
     */
    public static function settings(): array
    {
        $row = Template::query()
            ->where('kind', self::KIND)
            ->where('key', self::KEY)
            ->first();

        $fields = is_array($row?->fields) ? $row->fields : [];
        $body = is_string($fields['body'] ?? null) && trim($fields['body']) !== ''
            ? $fields['body']
            : self::DEFAULT_BODY;
        $senderId = $fields['senderId'] ?? null;

        return [
            'enabled' => (bool) ($fields['enabled'] ?? false),
            'senderId' => is_numeric($senderId) ? (int) $senderId : null,
            'body' => $body,
            'row' => $row,
        ];
    }

    /**
     * Save an administrator's settings. A message that is on needs a sender
     * who can send it; unknown placeholders are refused at the desk rather
     * than sent to someone as written.
     *
     * @param  array{enabled: bool, senderId: ?int, body: string}  $data
     */
    public static function save(array $data, User $by): void
    {
        $body = trim(str_replace(["\r\n", "\r"], "\n", $data['body']));

        if ($body === '') {
            throw ValidationException::withMessages(['body' => ['Write the message first.']]);
        }

        $known = array_keys(self::VARIABLES);
        foreach (Markup::tokens($body) as $token) {
            if (! in_array($token, $known, true)) {
                throw ValidationException::withMessages([
                    'body' => ['There is no {{'.$token.'}} placeholder. Use '.implode(', ', array_map(fn ($t) => '{{'.$t.'}}', $known)).'.'],
                ]);
            }
        }

        $senderId = $data['senderId'] ?? null;

        if ($senderId !== null && ! self::canSend(User::find($senderId))) {
            throw ValidationException::withMessages(['senderId' => ['Choose an active administrator to send it.']]);
        }

        if ($data['enabled'] && $senderId === null) {
            throw ValidationException::withMessages(['senderId' => ['Choose who it comes from.']]);
        }

        Template::query()->updateOrCreate(
            ['kind' => self::KIND, 'key' => self::KEY],
            [
                'name' => 'Welcome message',
                'fields' => ['enabled' => (bool) $data['enabled'], 'senderId' => $senderId, 'body' => $body],
                'updated_by' => $by->id,
            ],
        );
    }

    /**
     * Everyone who may be chosen to send it: active administrators.
     *
     * @return Collection<int, User>
     */
    public static function senders(): Collection
    {
        return User::query()
            ->where('status', User::STATUS_APPROVED)
            ->where('account_type', Role::ADMINISTRATOR)
            ->orderBy('name')
            ->get(['id', 'name', 'first_name', 'email', 'job_title', 'avatar_url', 'provider_avatar_url', 'account_type', 'status']);
    }

    /** An active administrator, the only kind of account that may send it. */
    public static function canSend(?User $sender): bool
    {
        return $sender !== null && ! $sender->trashed() && $sender->isApproved() && Role::isAdmin($sender);
    }

    /** The message as this person will read it. */
    public static function render(string $body, User $recipient, User $sender): string
    {
        return trim(Markup::fill($body, self::vars($recipient, $sender)));
    }

    /** The message as a sample new person would read it, for the editor. */
    public static function preview(string $body, ?User $sender): string
    {
        $recipient = new User;
        $recipient->forceFill(self::SAMPLE_RECIPIENT);

        // No sender chosen yet: show the placeholders it would fill.
        if ($sender === null) {
            return trim(Markup::fill($body, [
                'firstName' => $recipient->first_name,
                'name' => $recipient->name,
            ]));
        }

        return self::render($body, $recipient, $sender);
    }

    /**
     * A new account can use the portal: claim its welcome, and send it once
     * whatever activated the account has committed.
     *
     * Called from WelcomeMessageObserver with the account already claimed.
     * Never throws: a welcome that cannot go out is logged, and the approval
     * or sign-up that triggered it stands.
     */
    public static function afterActivation(User $user): void
    {
        $id = (int) $user->getKey();

        DB::afterCommit(function () use ($id) {
            try {
                self::deliver($id);
            } catch (Throwable $e) {
                Log::warning('The welcome message could not be sent.', ['user' => $id, 'reason' => $e->getMessage()]);
            }
        });
    }

    /**
     * Mark the account welcomed. True only for the one caller that did it,
     * so two approvals racing each other cannot both send.
     */
    public static function claim(User $user): bool
    {
        return User::withTrashed()
            ->whereKey($user->getKey())
            ->whereNull('welcomed_at')
            ->toBase()
            ->update(['welcomed_at' => now()]) === 1;
    }

    /** Post it, if it is on and can be. Null when nothing was sent. */
    public static function deliver(int $recipientId): ?Message
    {
        $settings = self::settings();

        if (! $settings['enabled'] || $settings['senderId'] === null) {
            return null;
        }

        $sender = User::find($settings['senderId']);
        $recipient = User::find($recipientId);

        if (! self::canSend($sender)) {
            Log::warning('The welcome message is on but its sender cannot send it.', ['sender' => $settings['senderId']]);

            return null;
        }

        if (! $recipient || ! $recipient->isApproved() || $recipient->is($sender)) {
            return null;
        }

        if (UserBlock::blockedBetween($sender->id, $recipient->id)) {
            return null;
        }

        $body = self::render($settings['body'], $recipient, $sender);

        if ($body === '') {
            return null;
        }

        [$conversation, $message, $mentioned] = DB::transaction(function () use ($sender, $recipient, $body) {
            $conversation = ClientConversations::resolveDirect($sender, $recipient);

            [$message, $mentioned] = Posting::write($conversation, $sender, [
                'type' => Message::TYPE_TEXT,
                'body' => $body,
            ]);

            return [$conversation, $message, $mentioned];
        });

        $message->load(Posting::RELATIONS);

        // Nobody's browser sent this one, so there is no tab to leave out.
        Broadcaster::to(new MessageSent($message));
        // The bell and the badge, without a second email: whatever let them
        // in (approval, an invitation) has already written to them.
        MessageNotifier::announceMessage($conversation, $message, $sender, $mentioned, email: false);
        // A brand-new thread has no subscribers yet, on either side.
        MessageNotifier::announceFirstCorrespondence($conversation, $message, $sender);
        Broadcaster::to(new InboxUpdated(
            user: $sender,
            reason: 'message',
            totalUnread: 0,
            conversationUuid: $conversation->uuid,
        ));

        return $message;
    }

    /** @return array<string, string> */
    private static function vars(User $recipient, User $sender): array
    {
        $first = trim((string) $recipient->first_name);
        if ($first === '') {
            $first = (string) strtok(trim((string) $recipient->name), ' ');
        }

        return [
            'firstName' => $first,
            'name' => trim((string) $recipient->name),
            'senderName' => trim((string) $sender->name),
            'senderTitle' => trim((string) $sender->job_title),
        ];
    }
}
