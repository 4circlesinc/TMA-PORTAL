<?php

namespace App\Support\Bespoke;

use App\Models\BespokeConversation;
use App\Models\BespokeMessage;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * This reader's Bespoke AI threads. Always scoped to user_id; a miss is a
 * 404, never a 403, so one account cannot learn that another has a chat.
 */
final class Conversations
{
    public static function findOwned(User $user, string $uuid): ?BespokeConversation
    {
        return BespokeConversation::query()
            ->where('user_id', $user->id)
            ->where('uuid', $uuid)
            ->first();
    }

    public static function findOwnedOrFail(User $user, string $uuid): BespokeConversation
    {
        $conversation = self::findOwned($user, $uuid);
        abort_unless($conversation !== null, 404);

        return $conversation;
    }

    /**
     * Reuse the client's conversation id when it is theirs. A uuid that
     * belongs to somebody else 404s. An unused uuid becomes a new thread.
     */
    public static function resolveForChat(User $user, ?string $uuid): BespokeConversation
    {
        if (is_string($uuid) && $uuid !== '') {
            $owned = self::findOwned($user, $uuid);
            if ($owned) {
                return $owned;
            }
            abort_if(BespokeConversation::query()->where('uuid', $uuid)->exists(), 404);
        }

        $conversation = new BespokeConversation;
        $conversation->uuid = (is_string($uuid) && $uuid !== '') ? $uuid : (string) Str::uuid();
        $conversation->user_id = $user->id;
        $conversation->title = 'New chat';
        $conversation->save();

        return $conversation;
    }

    /** Returns the stored user turn, so attachments can be tied to it. */
    public static function appendTurn(BespokeConversation $conversation, string $userText, string $reply): ?BespokeMessage
    {
        $userText = trim($userText);
        $reply = trim($reply);
        if ($userText === '') {
            return null;
        }

        $userMessage = $conversation->messages()->create([
            'role' => BespokeMessage::ROLE_USER,
            'body' => mb_substr($userText, 0, 4000),
        ]);
        if ($reply !== '') {
            $conversation->messages()->create([
                'role' => BespokeMessage::ROLE_ASSISTANT,
                'body' => mb_substr($reply, 0, 8000),
            ]);
        }

        if ($conversation->title === '' || $conversation->title === 'New chat') {
            $conversation->title = self::titleFrom($userText);
        }
        $conversation->last_message_at = now();
        $conversation->save();

        return $userMessage;
    }

    /** A line from the portal itself, such as "Sent to …", kept in the thread. */
    public static function appendNote(BespokeConversation $conversation, string $note): void
    {
        $note = trim($note);
        if ($note === '') {
            return;
        }
        $conversation->messages()->create([
            'role' => BespokeMessage::ROLE_ASSISTANT,
            'body' => mb_substr($note, 0, 2000),
        ]);
        $conversation->last_message_at = now();
        $conversation->save();
    }

    /** @return Collection<int, BespokeConversation> */
    public static function listFor(User $user): Collection
    {
        return BespokeConversation::query()
            ->where('user_id', $user->id)
            ->whereNotNull('last_message_at')
            ->with('latestMessage')
            ->orderByDesc('last_message_at')
            ->limit(100)
            ->get();
    }

    public static function rename(BespokeConversation $conversation, string $title): BespokeConversation
    {
        $conversation->title = self::titleFrom($title);
        $conversation->save();

        return $conversation;
    }

    /** @return array<string, mixed> */
    public static function listPayload(BespokeConversation $conversation): array
    {
        $last = $conversation->latestMessage;

        return [
            'uuid' => $conversation->uuid,
            'title' => $conversation->title ?: 'New chat',
            'updatedAt' => optional($conversation->last_message_at)->toIso8601String(),
            'preview' => $last ? self::preview($last->body) : '',
        ];
    }

    /** @return array<string, mixed> */
    public static function detailPayload(BespokeConversation $conversation): array
    {
        $conversation->loadMissing(['messages' => fn ($query) => $query->orderBy('id')->with('attachments')]);

        return [
            'uuid' => $conversation->uuid,
            'title' => $conversation->title ?: 'New chat',
            'updatedAt' => optional($conversation->last_message_at)->toIso8601String(),
            'messages' => $conversation->messages->sortBy('id')->values()->map(function (BespokeMessage $message) {
                return [
                    'role' => $message->role,
                    'content' => $message->body,
                    'createdAt' => optional($message->created_at)->toIso8601String(),
                    'attachments' => $message->attachments->map(fn ($a) => Attachments::payload($a))->values()->all(),
                ];
            })->values()->all(),
        ];
    }

    public static function titleFrom(string $text): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
        if ($text === '') {
            return 'New chat';
        }

        return Str::limit($text, 72, '…');
    }

    private static function preview(string $body): string
    {
        $body = preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $body) ?? $body;
        $body = preg_replace('/[*_`#]+/', '', $body) ?? $body;
        $body = trim(preg_replace('/\s+/u', ' ', $body) ?? '');

        return Str::limit($body, 96, '…');
    }
}
