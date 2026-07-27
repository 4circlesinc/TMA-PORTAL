<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\Log;

/**
 * Messaging's bridge into the notification system (§13).
 *
 * The Messages page has its own unread badge, so this exists for the moment
 * the user is *not* looking at it: a message or a missed call has to reach the
 * bell, the right sidebar and the Overview list like anything else does.
 *
 * Two rules shape everything here:
 *
 *  - **One live row per conversation.** A burst of ten messages is one thing
 *    that happened — the dedupe key collapses them and the Notifier's refresh
 *    keeps a running count, rather than burying every other module under a
 *    single chatty thread.
 *  - **Opening the conversation is acknowledgement.** Reading the thread marks
 *    its notifications read (`clearForConversation`), so the badge never
 *    outlives the thing it is pointing at.
 *
 * Nothing here may break a send: a message that was written and stored is sent,
 * whatever the notification layer does afterwards.
 */
final class MessageNotifier
{
    /** How long a conversation's unread row keeps collecting new arrivals. */
    private const MESSAGE_DEDUPE_MINUTES = 1440;

    /** A re-ring inside this window folds into the same missed-call row. */
    private const CALL_DEDUPE_MINUTES = 15;

    /** Preview length: enough to recognise the message, short enough to scan. */
    private const PREVIEW_CHARS = 120;

    /** Tell everyone else in the conversation that a message landed. */
    public static function announceMessage(Conversation $conversation, Message $message, User $sender): void
    {
        try {
            $preview = self::preview($message);
            $url = self::url($conversation);

            foreach (self::recipients($conversation, $sender->id) as $participant) {
                $recipient = $participant->user;
                if (! $recipient) {
                    continue;
                }

                Notifier::send([
                    'user' => $recipient,
                    'actor' => $sender,
                    'type' => self::typeFor($conversation, $message, $recipient),
                    'title' => $conversation->isGroup()
                        ? MessagingPresenter::title($conversation, $recipient)
                        : $sender->name,
                    'message' => $conversation->isGroup()
                        ? $sender->name.': '.$preview
                        : $preview,
                    'subject' => $conversation,
                    'action_url' => $url,
                    'dedupe_key' => self::messageKey($conversation),
                    'dedupe_minutes' => self::MESSAGE_DEDUPE_MINUTES,
                    'metadata' => [
                        'conversationId' => $conversation->uuid,
                        'messageId' => $message->uuid,
                    ],
                ]);
            }
        } catch (\Throwable $e) {
            // The message is already stored and broadcast; a failure here is a
            // missing badge, never a failed send.
            Log::warning('MessageNotifier.announceMessage failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Tell whoever missed a call that they did.
     *
     * The person who *placed* the call knows how it went — they watched it ring
     * out — and the person who declined it chose to. So the recipient set is
     * everyone else: in practice the callee of a call the caller gave up on.
     *
     * @param  User  $actingUser  whoever ended the call (caller or callee)
     */
    public static function announceMissedCall(
        Conversation $conversation,
        User $actingUser,
        ?int $initiatorId,
        string $label,
    ): void {
        try {
            $caller = $initiatorId ? User::find($initiatorId) : null;
            $skip = array_values(array_filter([$actingUser->id, $initiatorId]));

            foreach (self::recipients($conversation, ...$skip) as $participant) {
                $recipient = $participant->user;
                if (! $recipient) {
                    continue;
                }

                $from = $caller?->name ?: MessagingPresenter::title($conversation, $recipient);

                Notifier::send([
                    'user' => $recipient,
                    'actor' => $caller,
                    'type' => 'call.missed',
                    'title' => 'Missed '.mb_strtolower($label),
                    'message' => $conversation->isGroup()
                        ? $from.' called the group'
                        : $from.' tried to reach you',
                    'subject' => $conversation,
                    'action_url' => self::url($conversation),
                    'dedupe_key' => self::callKey($conversation),
                    'dedupe_minutes' => self::CALL_DEDUPE_MINUTES,
                    'metadata' => ['conversationId' => $conversation->uuid],
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('MessageNotifier.announceMissedCall failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Opening the conversation settles its notifications.
     *
     * A direct update rather than the Notifier: this touches rows in bulk and
     * raises nothing, so there is no preference or dedupe decision to make.
     */
    public static function clearForConversation(User $user, Conversation $conversation): void
    {
        try {
            Notification::query()
                ->where('user_id', $user->id)
                ->whereNull('read_at')
                ->whereIn('dedupe_key', [self::messageKey($conversation), self::callKey($conversation)])
                ->update(['read_at' => now()]);
        } catch (\Throwable $e) {
            Log::warning('MessageNotifier.clearForConversation failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Who should hear about this: members who are still in the conversation,
     * have not muted it, and did not cause the event themselves.
     *
     * @return \Illuminate\Support\Collection<int, ConversationParticipant>
     */
    private static function recipients(Conversation $conversation, int ...$excludeUserIds)
    {
        return $conversation->activeParticipants()
            ->with('user')
            ->get()
            ->reject(fn (ConversationParticipant $p) => in_array($p->user_id, $excludeUserIds, true))
            // Muting a conversation is exactly the request not to be told about
            // it — the Messages badge still counts it, the bell stays quiet.
            ->reject(fn (ConversationParticipant $p) => $p->isMuted());
    }

    /** Which registry type this message is, from the recipient's point of view. */
    private static function typeFor(Conversation $conversation, Message $message, User $recipient): string
    {
        if ($conversation->isGroup()) {
            return 'message.group';
        }

        if ($message->replyTo && $message->replyTo->user_id === $recipient->id) {
            return 'message.reply';
        }

        if ($message->type === Message::TYPE_ATTACHMENT || $message->type === Message::TYPE_VOICE) {
            return 'message.attachment';
        }

        return 'message.received';
    }

    /** What the notification says the message was. */
    private static function preview(Message $message): string
    {
        $body = trim((string) $message->body);
        if ($body !== '') {
            return mb_strimwidth($body, 0, self::PREVIEW_CHARS, '…');
        }

        return match ($message->type) {
            Message::TYPE_VOICE => 'Sent a voice note',
            Message::TYPE_ATTACHMENT => 'Sent an attachment',
            default => 'Sent a message',
        };
    }

    private static function url(Conversation $conversation): string
    {
        return '/social/messages?conversation='.$conversation->uuid;
    }

    private static function messageKey(Conversation $conversation): string
    {
        return 'message:'.$conversation->id;
    }

    private static function callKey(Conversation $conversation): string
    {
        return 'call:'.$conversation->id;
    }
}
