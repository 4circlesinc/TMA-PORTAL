<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageMention;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Who a group message is addressed to: a member written as @Their Name, or
 * the whole group written as @all.
 *
 * The message's own text is the record. Whoever is named in it is mentioned,
 * however the name got there: picked from the composer's list, typed out by
 * hand, restored from a draft after a reload, or added in an edit. A list of
 * ids sent alongside the text would have to be kept in step with it through
 * all four, and would let a request notify someone the message never names.
 */
final class Mentions
{
    /** What follows the @ to address everyone in the group. */
    public const EVERYONE = 'all';

    /**
     * Record who this message addresses, and say who is newly addressed.
     *
     * Safe to call again after an edit: people the new text no longer names
     * are dropped, and only those it has just started naming come back, so
     * correcting a typo does not notify the same person twice.
     *
     * @return array{users: list<int>, all: bool}
     */
    public static function sync(Message $message, Conversation $conversation): array
    {
        $wanted = self::read($message, $conversation);

        // A message being sent has nothing recorded yet; only an edit does.
        $existing = $message->wasRecentlyCreated
            ? collect()
            : MessageMention::where('message_id', $message->id)->get();
        $had = [];

        foreach ($existing as $row) {
            $keep = $row->isEveryone()
                ? $wanted['all'] !== null
                : isset($wanted['users'][$row->user_id]);

            if (! $keep) {
                $row->delete();

                continue;
            }

            $had[$row->user_id ?? 0] = true;
        }

        $new = ['users' => [], 'all' => false];

        foreach ($wanted['users'] as $userId => $label) {
            if (isset($had[$userId])) {
                continue;
            }

            self::record($message, $conversation, $userId, $label);
            $new['users'][] = $userId;
        }

        if ($wanted['all'] !== null && ! isset($had[0])) {
            self::record($message, $conversation, null, $wanted['all']);
            $new['all'] = true;
        }

        return $new;
    }

    /** A deleted message addresses nobody. */
    public static function forget(Message $message): void
    {
        MessageMention::where('message_id', $message->id)->delete();
    }

    /**
     * Conversations holding something addressed to this reader that they have
     * not read yet.
     *
     * One query for the whole chat list. The reader's own @all never counts:
     * sending moves their read mark past the message that carries it.
     *
     * @param  ?list<int>  $conversationIds  Narrow to these, when only some are being asked about.
     * @return list<int>
     */
    public static function awaiting(User $reader, ?array $conversationIds = null): array
    {
        if ($conversationIds === []) {
            return [];
        }

        return DB::table('message_mentions as mm')
            ->join('conversation_participants as p', function ($join) use ($reader) {
                $join->on('p.conversation_id', '=', 'mm.conversation_id')
                    ->where('p.user_id', '=', $reader->id);
            })
            ->whereNull('p.left_at')
            ->where(function ($query) use ($reader) {
                $query->where('mm.user_id', $reader->id)->orWhereNull('mm.user_id');
            })
            ->whereRaw('mm.message_id > coalesce(p.last_read_message_id, 0)')
            ->whereRaw('mm.message_id > coalesce(p.cleared_before_message_id, 0)')
            ->when($conversationIds !== null, fn ($query) => $query->whereIn('mm.conversation_id', $conversationIds))
            ->distinct()
            ->pluck('mm.conversation_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * The people a member of this group may address, for the composer's list.
     *
     * @return list<array{id: int, name: string, photo: ?string}>
     */
    public static function mentionable(Conversation $conversation, User $viewer): array
    {
        if (! $conversation->isGroup()) {
            return [];
        }

        return $conversation->loadMissing('activeParticipants.user')->activeParticipants
            ->where('user_id', '!=', $viewer->id)
            ->map(fn (ConversationParticipant $participant) => $participant->user)
            ->filter(fn (?User $user) => $user !== null && trim((string) $user->name) !== '')
            ->sortBy(fn (User $user) => mb_strtolower($user->name))
            ->map(fn (User $user) => [
                'id' => (int) $user->id,
                'name' => trim($user->name),
                'photo' => $user->avatar_url,
            ])
            ->values()
            ->all();
    }

    /**
     * Read the names out of the text.
     *
     * @return array{users: array<int, string>, all: ?string} user id => the name as written; the @all as written
     */
    private static function read(Message $message, Conversation $conversation): array
    {
        $none = ['users' => [], 'all' => null];
        $body = (string) $message->body;

        if (! $conversation->isGroup() || $message->isSystem() || $message->trashed() || ! str_contains($body, '@')) {
            return $none;
        }

        // Members only, and never the author: nobody mentions themselves.
        $names = [];

        $members = $conversation->loadMissing('activeParticipants.user')->activeParticipants
            ->where('user_id', '!=', $message->user_id);

        foreach ($members as $member) {
            $name = trim((string) $member->user?->name);

            if ($name === '') {
                continue;
            }

            // Two colleagues with one name are both meant: the text cannot
            // tell them apart, and leaving one out would be a guess.
            $names[mb_strtolower($name)]['name'] = $name;
            $names[mb_strtolower($name)]['ids'][] = (int) $member->user_id;
        }

        // Longest first, and each one taken out of the text as it is found,
        // so "@Ann Marie Joseph" is not also read as "@Ann".
        uasort($names, fn (array $a, array $b) => mb_strlen($b['name']) <=> mb_strlen($a['name']));

        $found = [];

        foreach ($names as $entry) {
            $pattern = self::pattern($entry['name']);

            if (preg_match($pattern, $body, $match) !== 1) {
                continue;
            }

            foreach ($entry['ids'] as $id) {
                $found[$id] = mb_substr($match[0], 1);
            }

            $body = preg_replace($pattern, ' ', $body) ?? $body;
        }

        $all = preg_match(self::pattern(self::EVERYONE), $body, $match) === 1
            ? mb_substr($match[0], 1)
            : null;

        return ['users' => $found, 'all' => $all];
    }

    /**
     * "@name" standing on its own.
     *
     * Not inside a word or an address (someone@all.example is not @all), and
     * not the start of a longer word (@allan is not @all).
     */
    private static function pattern(string $name): string
    {
        return '/(?<![\p{L}\p{N}_@])@'.preg_quote($name, '/').'(?![\p{L}\p{N}_])/iu';
    }

    private static function record(Message $message, Conversation $conversation, ?int $userId, string $label): void
    {
        MessageMention::create([
            'message_id' => $message->id,
            'conversation_id' => $conversation->id,
            'user_id' => $userId,
            'label' => mb_substr($label, 0, 160),
        ]);
    }
}
