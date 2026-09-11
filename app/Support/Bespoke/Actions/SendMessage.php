<?php

namespace App\Support\Bespoke\Actions;

use App\Events\MessageSent;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Models\UserBlock;
use App\Support\Bespoke\People;
use App\Support\Messaging\Broadcaster;
use App\Support\Messaging\ClientConversations;
use App\Support\Messaging\MessageNotifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Send a text message from the reader to one person, the way the Messages
 * page does it: find or create the direct thread, store the message, mark
 * it read for the sender, then broadcast and notify. Mirrors
 * MessagingController::send() for the plain-text case; keep the two in step.
 */
final class SendMessage
{
    /**
     * @return array{conversationUuid: string, messageUuid: string, url: string, recipient: array<string, mixed>}
     */
    public static function run(User $sender, int $recipientId, string $body): array
    {
        $body = trim($body);
        if ($body === '') {
            throw ValidationException::withMessages(['body' => 'A message needs some text.']);
        }

        $recipient = People::reachableById($sender, $recipientId);
        if ($recipient === null) {
            throw ValidationException::withMessages(['userId' => 'You cannot message that person from here.']);
        }
        if (UserBlock::blockedBetween($sender->id, $recipient->id)) {
            throw ValidationException::withMessages(['userId' => 'This conversation is unavailable.']);
        }

        $conversation = ClientConversations::resolveDirect($sender, $recipient);

        $message = DB::transaction(function () use ($conversation, $sender, $body) {
            $message = $conversation->messages()->create([
                'user_id' => $sender->id,
                'type' => Message::TYPE_TEXT,
                'body' => $body,
                'reply_to_id' => null,
                'client_nonce' => null,
            ]);

            $conversation->forceFill(['last_message_at' => $message->created_at])->save();

            ConversationParticipant::where('conversation_id', $conversation->id)
                ->where('user_id', $sender->id)
                ->update([
                    'last_read_message_id' => $message->id,
                    'last_read_at' => now(),
                    'marked_unread_at' => null,
                    'draft' => null,
                ]);

            return $message;
        });

        $message->load(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender', 'replyTo.attachments']);

        // No socket id to exclude: the sender's own Messages tab, if open,
        // has not rendered this message and should receive it too.
        Broadcaster::toOthers(new MessageSent($message));
        MessageNotifier::announceMessage($conversation, $message, $sender);
        MessageNotifier::announceFirstCorrespondence($conversation, $message, $sender);

        return [
            'conversationUuid' => $conversation->uuid,
            'messageUuid' => (string) $message->uuid,
            'url' => '/social/messages?conversation='.rawurlencode($conversation->uuid),
            'recipient' => People::row($recipient),
        ];
    }
}
