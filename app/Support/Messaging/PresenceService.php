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

        AvailabilityService::recompute($user, $presence, announce: ! $wasOnline);

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
            AvailabilityService::recompute($user, $presence, announce: true);
        }

        self::announce($user, false, self::label(now()));
    }

    /**
     * How long a closed page keeps somebody online, in case it was a reload
     * or another of their windows is about to renew.
     */
    public const LEAVING_GRACE_SECONDS = 10;

    /**
     * The last page this browser had open is closing.
     *
     * Not {@see release()}: a reload sends this too, and so does a window
     * closing while the phone app is still open. The lease is cut to a few
     * seconds instead, so a page that comes straight back renews it and
     * nobody sees a flicker, and one that does not lapses and is announced
     * by {@see expireLapsed()} within the minute rather than whenever the
     * full lease would have run out.
     */
    public static function leaving(User $user): void
    {
        UserPresence::where('user_id', $user->id)
            ->where('online_until', '>', now()->addSeconds(self::LEAVING_GRACE_SECONDS))
            ->update(['online_until' => now()->addSeconds(self::LEAVING_GRACE_SECONDS)]);
    }

    /**
     * Announce everyone whose heartbeat stopped without saying goodbye.
     *
     * Online is a lease the heartbeat renews. A tab that is killed, a laptop
     * that sleeps, a phone that loses signal: none of them calls release(),
     * so their lease lapsed in silence. Every reader that asked afterwards
     * was told the truth, but every screen already showing them online — a
     * conversation header, the team board, a group's faces — kept the green
     * dot it had, because no event ever said otherwise. The scheduler runs
     * this every minute.
     *
     * Each row is claimed with a conditional update before it is announced,
     * so a heartbeat landing at the same moment wins and the person is not
     * marked offline under it.
     *
     * @return int how many people were announced offline
     */
    public static function expireLapsed(int $limit = 500): int
    {
        $lapsed = UserPresence::query()
            ->whereNotNull('online_until')
            ->where('online_until', '<=', now())
            ->orderBy('online_until')
            ->limit($limit)
            ->get();

        $announced = 0;

        foreach ($lapsed as $presence) {
            $claimed = UserPresence::query()
                ->whereKey($presence->getKey())
                ->where('online_until', '<=', now())
                ->update(['online_until' => null]);

            if ($claimed !== 1) {
                continue;
            }

            $user = User::find($presence->user_id);
            if ($user === null) {
                continue;
            }

            $presence->online_until = null;
            $presence->syncOriginalAttribute('online_until');
            AvailabilityService::recompute($user, $presence, announce: true);
            self::announce(
                $user,
                false,
                $presence->last_seen_at ? LastSeen::label($presence->last_seen_at) : null,
            );
            $announced++;
        }

        return $announced;
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
