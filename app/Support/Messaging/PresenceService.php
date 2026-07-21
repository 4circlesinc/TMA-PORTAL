<?php

namespace App\Support\Messaging;

use App\Models\User;
use App\Models\UserPresence;
use Illuminate\Support\Carbon;

/**
 * Online / last-seen state, filtered through the subject's privacy settings.
 *
 * Nothing here decides what to *store* based on privacy - presence is always
 * recorded. Privacy is applied when someone asks, so a user can turn "last
 * seen" back on without a gap in their own history.
 */
class PresenceService
{
    /** Record that this user is currently active. Called by the heartbeat. */
    public static function touch(User $user): UserPresence
    {
        $presence = UserPresence::firstOrNew(['user_id' => $user->id]);
        $presence->last_seen_at = now();
        $presence->online_until = now()->addSeconds(UserPresence::ONLINE_TTL_SECONDS);
        $presence->save();

        return $presence;
    }

    /** Mark a user offline immediately, on an explicit disconnect. */
    public static function release(User $user): void
    {
        UserPresence::where('user_id', $user->id)->update([
            'last_seen_at' => now(),
            'online_until' => null,
        ]);
    }

    /**
     * Presence for $subject as $viewer is permitted to see it.
     *
     * Returns the shape the chat list and conversation header already render:
     * either {online:true} or a {lastSeen:"..."} label. When the subject hides
     * their detail we still return something human - "Last seen recently" -
     * rather than leaking the absence of data as a distinct state.
     */
    public static function forViewer(User $subject, User $viewer, ?UserPresence $presence = null): array
    {
        $presence ??= UserPresence::where('user_id', $subject->id)->first();

        $showOnline = MessagingSettings::allowsVisibility($subject, $viewer, 'onlineStatus');
        $showLastSeen = MessagingSettings::allowsVisibility($subject, $viewer, 'lastSeen');

        if ($presence?->isOnline() && $showOnline) {
            return ['online' => true];
        }

        if (! $showLastSeen || ! $presence?->last_seen_at) {
            return ['online' => false, 'lastSeen' => 'Last seen recently'];
        }

        return [
            'online' => false,
            'lastSeen' => self::label($presence->last_seen_at),
            'lastSeenAt' => $presence->last_seen_at->toIso8601String(),
        ];
    }

    /** "Last seen 12 min ago" / "Last seen yesterday" / "Last seen Mar 7". */
    private static function label(Carbon $at): string
    {
        if ($at->isToday()) {
            return 'Last seen '.$at->diffForHumans(short: true, syntax: Carbon::DIFF_ABSOLUTE).' ago';
        }

        if ($at->isYesterday()) {
            return 'Last seen yesterday';
        }

        return 'Last seen '.$at->format($at->isCurrentYear() ? 'M j' : 'M j, Y');
    }
}
