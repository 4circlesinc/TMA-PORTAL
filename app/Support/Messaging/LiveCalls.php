<?php

namespace App\Support\Messaging;

use Illuminate\Support\Facades\Cache;

/**
 * Calls that are ringing right now, kept for a minute and a half.
 *
 * The websocket carries a call's `ring` once. A phone that was asleep, or an
 * app that was closed, only hears about it from a push, so whatever it opens
 * afterwards has missed that ring. This record is how it catches up:
 *
 *   - the page an app opens for an answer asks for the ring by its signalId
 *     and picks the call up as if it had heard it (messaging-calls.js);
 *   - a phone ringing from a push, which cannot hear the socket, asks whether
 *     it should still be ringing (PushCallController), and an Android phone
 *     is also pushed the moment it should stop (Push::callEnded);
 *   - a decline from the phone's own call screen finds the call to decline.
 *
 * A call stops ringing once: answered, declined, or given up on by the caller.
 * The outcome is kept a little longer, so a phone asking late is still told
 * whether it was answered elsewhere or simply missed.
 *
 * Record: {signal, conversation, callerId, recipients[], media, outcome, by}
 * where outcome is null while ringing, else answered|declined|missed|ended.
 */
final class LiveCalls
{
    /** Past the caller's 40 s ring and the push's 45 s delivery window. */
    public const TTL_SECONDS = 90;

    public const ANSWERED = 'answered';

    public const DECLINED = 'declined';

    public const MISSED = 'missed';

    public const ENDED = 'ended';

    /**
     * A call starts ringing.
     *
     * @param  array<string, mixed>  $signal  CallSignal::broadcastWith()
     * @param  int[]  $recipientIds
     */
    public static function ring(array $signal, array $recipientIds): void
    {
        $id = (string) ($signal['signalId'] ?? '');
        $conversation = (string) ($signal['conversationId'] ?? '');
        if ($id === '' || $conversation === '') {
            return;
        }

        $payload = is_array($signal['payload'] ?? null) ? $signal['payload'] : [];

        Cache::put(self::key($id), [
            'signal' => $signal,
            'conversation' => $conversation,
            'callerId' => (int) ($signal['fromUserId'] ?? 0),
            'recipients' => array_values(array_map('intval', $recipientIds)),
            'media' => ($payload['media'] ?? 'audio') === 'video' ? 'video' : 'audio',
            'outcome' => null,
            'by' => null,
        ], self::TTL_SECONDS);
        // A newer ring in the same conversation replaces the older one.
        Cache::put(self::conversationKey($conversation), $id, self::TTL_SECONDS);
    }

    /**
     * The conversation's ringing call stops ringing. Returns the record as it
     * stood once settled, or null when nothing was ringing there (already
     * answered, a hangup during the call itself, or long gone).
     *
     * @return array<string, mixed>|null
     */
    public static function settle(string $conversation, string $outcome, int $byUserId): ?array
    {
        $id = Cache::pull(self::conversationKey($conversation));
        if (! is_string($id) || $id === '') {
            return null;
        }

        $record = Cache::get(self::key($id));
        if (! is_array($record) || $record['outcome'] !== null) {
            return null;
        }

        $record['outcome'] = $outcome;
        $record['by'] = $byUserId;
        Cache::put(self::key($id), $record, self::TTL_SECONDS);

        return $record;
    }

    /**
     * The outcome a signal settles a ringing call with, or null for a signal
     * that leaves it ringing (offer, ice, state...).
     */
    public static function outcomeFor(string $type, int $fromUserId, string $conversation): ?string
    {
        return match ($type) {
            'accept' => self::ANSWERED,
            'reject' => self::DECLINED,
            // The caller giving up (or the 40 s clock) is a missed call; a
            // hangup from anyone else while it rings just ends it.
            'hangup' => self::callerOf($conversation) === $fromUserId ? self::MISSED : self::ENDED,
            default => null,
        };
    }

    /** @return array<string, mixed>|null */
    public static function find(string $signalId): ?array
    {
        if ($signalId === '') {
            return null;
        }
        $record = Cache::get(self::key($signalId));

        return is_array($record) ? $record : null;
    }

    /** @param  array<string, mixed>|null  $record */
    public static function isRinging(?array $record): bool
    {
        return $record !== null && $record['outcome'] === null;
    }

    /** @param  array<string, mixed>  $record */
    public static function rings(array $record, int $userId): bool
    {
        return in_array($userId, $record['recipients'] ?? [], true);
    }

    private static function callerOf(string $conversation): ?int
    {
        $id = Cache::get(self::conversationKey($conversation));
        $record = is_string($id) ? self::find($id) : null;

        return $record !== null ? (int) $record['callerId'] : null;
    }

    private static function key(string $signalId): string
    {
        return 'calls:live:'.$signalId;
    }

    private static function conversationKey(string $conversation): string
    {
        return 'calls:ringing:'.$conversation;
    }
}
