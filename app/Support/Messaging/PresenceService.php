<?php

namespace App\Support\Messaging;

use App\Events\PresenceChanged;
use App\Models\Conversation;
use App\Models\User;
use App\Models\UserPresence;
use App\Support\Presence\AvailabilityService;
use App\Support\Presence\LastSeen;
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
    /**
     * How many conversations a presence change fans out to.
     *
     * A transition is rare, but somebody in hundreds of threads would still
     * make one heartbeat into hundreds of publishes. The most recent
     * conversations are the ones somebody is plausibly looking at; the rest
     * pick the change up on their next poll.
     */
    private const ANNOUNCE_LIMIT = 50;

    /**
     * Record that this user is currently active. Called by the heartbeat.
     *
     * Announces a change only when they were not already online. Heartbeats
     * arrive every few seconds; broadcasting each one would be a lot of
     * traffic to repeat something every listener already knows.
     */
    public static function touch(User $user): UserPresence
    {
        $presence = UserPresence::firstOrNew(['user_id' => $user->id]);
        $wasOnline = $presence->exists && $presence->isOnline();

        $presence->last_seen_at = now();
        $presence->online_until = now()->addSeconds(UserPresence::ONLINE_TTL_SECONDS);
        $presence->save();

        AvailabilityService::recompute($user, $presence);

        if (! $wasOnline) {
            self::announce($user, true);
        }

        return $presence;
    }

    /** Mark a user offline immediately, on an explicit disconnect. */
    public static function release(User $user): void
    {
        UserPresence::where('user_id', $user->id)->update([
            'last_seen_at' => now(),
            'online_until' => null,
        ]);

        $presence = UserPresence::where('user_id', $user->id)->first();
        if ($presence) {
            AvailabilityService::recompute($user, $presence);
        }

        self::announce($user, false, self::label(now()));
    }

    /**
     * Tell this user's conversations that they came online or went offline.
     *
     * Sent on the conversation channels, which means every recipient shares a
     * conversation with them by construction - so the "contacts only" setting
     * is already satisfied and needs no further filtering here. Only an
     * outright "nobody" has to be suppressed, and it is suppressed at the
     * source: the event is never emitted rather than emitted and filtered.
     */
    private static function announce(User $user, bool $online, ?string $lastSeenLabel = null): void
    {
        if (MessagingSettings::get($user, 'onlineStatus') === MessagingSettings::NOBODY) {
            return;
        }

        // Someone who hides last-seen still shows online/offline; withholding
        // the label is what "hidden" means, not withholding the transition.
        if (MessagingSettings::get($user, 'lastSeen') === MessagingSettings::NOBODY) {
            $lastSeenLabel = 'Last seen recently';
        }

        $uuids = Conversation::query()
            ->forUser($user)
            ->orderByDesc('last_message_at')
            ->limit(self::ANNOUNCE_LIMIT)
            ->pluck('uuid')
            ->all();

        if ($uuids === []) {
            return;
        }

        // toOthers excludes the originating socket only, so this user's other
        // open tabs still hear it - which is what we want.
        Broadcaster::toOthers(new PresenceChanged($user, $online, $uuids, $lastSeenLabel));
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
        /*
         * Prefer an eager-loaded relation over a fresh query. Callers that
         * present a whole list (the conversation index) load
         * `activeParticipants.user.presence` up front; without this check each
         * participant would still cost a query of its own.
         */
        if ($presence === null && $subject->relationLoaded('presence')) {
            $presence = $subject->presence;
        } elseif ($presence === null) {
            $presence = UserPresence::where('user_id', $subject->id)->first();
        }

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
            // Rendered on the *viewer's* wall clock, "yesterday at 8:15 PM"
            // is only true in one time zone, and this answer has one reader.
            'lastSeen' => LastSeen::label($presence->last_seen_at, $viewer),
            'lastSeenAt' => $presence->last_seen_at->toIso8601String(),
        ];
    }

    /**
     * The label carried by a broadcast presence change.
     *
     * Deliberately not the reader-zone formatter: this string is fanned out to
     * every participant at once, so it can only be one that means the same
     * thing everywhere. It is only ever emitted on an explicit disconnect,
     * which is always "just now".
     */
    private static function label(Carbon $at): string
    {
        return LastSeen::label($at);
    }
}
