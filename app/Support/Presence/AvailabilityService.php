<?php

namespace App\Support\Presence;

use App\Events\UserStatusChanged;
use App\Models\User;
use App\Models\UserLocation;
use App\Models\UserPresence;
use App\Models\UserPresenceState;
use App\Models\UserStatusSchedule;
use App\Support\Messaging\Broadcaster;
use App\Support\Messaging\MessagingSettings;
use App\Support\Messaging\PresenceService;
use Illuminate\Support\Carbon;

/**
 * Layered availability: multiple states may be true; one primary is shown.
 *
 * Integrates with the existing online heartbeat in PresenceService. Online/
 * offline is still derived from online_until; availability statuses sit on top.
 */
class AvailabilityService
{
    /**
     * user_id => their layered states, for a listing that reads many people.
     *
     * Null means "not primed": every caller then behaves exactly as it did.
     *
     * Reading one person's availability costs four queries — two purge
     * deletes, the states themselves, and a re-read of the presence row — and
     * the Dashboard's Employees card reads every member of staff. That is 4n
     * round trips for a card showing thirteen faces: ten seconds against the
     * remote database, on the same page load as everything else.
     *
     * Almost nobody has a layered state at all (they are set by a call, a
     * geofence, a manual pick), so the whole 4n is usually spent establishing
     * that there is nothing to establish. One query answers it for the entire
     * page, and the three per-person queries fall away for anyone with none.
     *
     * @var array<int, list<UserPresenceState>>|null
     */
    private static ?array $primedStates = null;

    /**
     * Load the layered states of a set of people in one query.
     *
     * Per-request and advisory: a state written after this runs is still seen,
     * because every write path goes through setState/clearState, which drop
     * the priming.
     *
     * @param  iterable<int|string|User>  $users
     */
    public static function primeStates(iterable $users): void
    {
        $ids = [];
        foreach ($users as $user) {
            $id = (int) ($user instanceof User ? $user->id : $user);
            if ($id) {
                $ids[$id] = true;
            }
        }

        if ($ids === []) {
            self::$primedStates = [];

            return;
        }

        $rows = UserPresenceState::whereIn('user_id', array_keys($ids))->get();

        // Seed every id asked for, so "primed and empty" is distinguishable
        // from "not primed" — that difference is the whole saving.
        self::$primedStates = array_fill_keys(array_keys($ids), []);
        foreach ($rows as $row) {
            self::$primedStates[(int) $row->user_id][] = $row;
        }
    }

    /** Forget the primed states. Any write to a state calls this. */
    public static function forgetPrimedStates(): void
    {
        self::$primedStates = null;
    }

    /** @return list<UserPresenceState>|null */
    private static function primed(User $user): ?array
    {
        return self::$primedStates[$user->id] ?? null;
    }

    /**
     * Upsert an active layered state for a user.
     *
     * @param  array<string, mixed>|null  $meta
     */
    public static function setState(
        User $user,
        string $status,
        string $source,
        ?Carbon $expiresAt = null,
        ?Carbon $startsAt = null,
        ?string $message = null,
        ?array $meta = null,
    ): UserPresenceState {
        $row = UserPresenceState::updateOrCreate(
            ['user_id' => $user->id, 'status' => $status],
            [
                'source' => $source,
                'status_message' => $message,
                'starts_at' => $startsAt,
                'expires_at' => $expiresAt,
                'meta' => $meta,
            ]
        );

        self::forgetPrimedStates();
        self::recompute($user);

        return $row;
    }

    /** Remove one layered state (call ended, manual clear, location left, …). */
    public static function clearState(User $user, string $status): void
    {
        UserPresenceState::where('user_id', $user->id)->where('status', $status)->delete();
        self::forgetPrimedStates();
        self::recompute($user);
    }

    /** Drop expired states and apply schedules, then resolve primary. */
    public static function recompute(User $user, ?UserPresence $presence = null): UserPresence
    {
        return self::syncPrimary($user, $presence, true);
    }

    /**
     * Resolve primary status. Persists and broadcasts only when it changed,
     * so list endpoints that read many users do not write per row.
     */
    private static function syncPrimary(User $user, ?UserPresence $presence = null, bool $applySchedules = false): UserPresence
    {
        self::purgeExpired($user);
        if ($applySchedules) {
            self::applySchedules($user);
        }

        $presence = $presence ?? UserPresence::firstOrCreate(['user_id' => $user->id]);
        $online = $presence->isOnline();
        $primary = self::resolvePrimary($user, $online);

        $changed = $presence->primary_status !== $primary['status']
            || $presence->status_source !== $primary['source']
            || $presence->status_message !== $primary['message']
            || (string) $presence->status_expires_at !== (string) ($primary['expiresAt'] ?? null);

        if ($changed) {
            $presence->forceFill([
                'primary_status' => $primary['status'],
                'status_source' => $primary['source'],
                'status_message' => $primary['message'],
                'status_started_at' => $primary['startedAt'],
                'status_expires_at' => $primary['expiresAt'],
            ])->save();

            self::announce($user, $primary);
        }

        return $presence;
    }

    /**
     * Manual status from the header dropdown.
     *
     * @param  array<string, mixed>  $opts  expiresAt, startsAt, message
     */
    public static function setManual(User $user, string $status, array $opts = []): UserPresence
    {
        if ($status === AvailabilityStatus::ONLINE || $status === AvailabilityStatus::AVAILABLE) {
            UserPresenceState::where('user_id', $user->id)
                ->whereIn('source', [
                    AvailabilityStatus::SOURCE_MANUAL,
                    AvailabilityStatus::SOURCE_SCHEDULED,
                ])
                ->delete();

            self::forgetPrimedStates();

            return self::recompute($user);
        }

        self::setState(
            $user,
            $status,
            AvailabilityStatus::SOURCE_MANUAL,
            isset($opts['expiresAt']) ? Carbon::parse($opts['expiresAt']) : null,
            isset($opts['startsAt']) ? Carbon::parse($opts['startsAt']) : now(),
            $opts['message'] ?? null,
        );

        return UserPresence::where('user_id', $user->id)->first();
    }

    /** Call module: active WebRTC session. */
    public static function setOnCall(User $user, bool $on): void
    {
        if ($on) {
            self::setState($user, AvailabilityStatus::ON_CALL, AvailabilityStatus::SOURCE_CALL);
        } else {
            self::clearState($user, AvailabilityStatus::ON_CALL);
        }
    }

    /**
     * Location check from the browser. Coordinates are never stored or broadcast.
     *
     * @param  array{lat: float, lng: float}  $coords
     */
    public static function applyLocation(User $user, array $coords): void
    {
        $office = UserLocation::where('user_id', $user->id)
            ->where('type', UserLocation::TYPE_OFFICE)->where('enabled', true)->first();
        $remote = UserLocation::where('user_id', $user->id)
            ->where('type', UserLocation::TYPE_REMOTE)->where('enabled', true)->first();

        $lat = (float) ($coords['lat'] ?? 0);
        $lng = (float) ($coords['lng'] ?? 0);
        $accuracyM = isset($coords['accuracyM']) ? max(0.0, (float) $coords['accuracyM']) : 0.0;

        $inOffice = $office && self::withinGeofence($office, $lat, $lng, $accuracyM);
        $inRemote = ! $inOffice && $remote && self::withinGeofence($remote, $lat, $lng, $accuracyM);

        if ($inOffice) {
            self::setState(
                $user,
                AvailabilityStatus::IN_OFFICE,
                AvailabilityStatus::SOURCE_LOCATION,
                meta: ['locationSource' => 'gps'],
            );
            self::clearState($user, AvailabilityStatus::WORKING_REMOTE);
        } elseif ($inRemote) {
            self::setState(
                $user,
                AvailabilityStatus::WORKING_REMOTE,
                AvailabilityStatus::SOURCE_LOCATION,
                meta: ['locationSource' => 'gps'],
            );
            self::clearState($user, AvailabilityStatus::IN_OFFICE);
        } else {
            self::clearState($user, AvailabilityStatus::IN_OFFICE);
            self::clearState($user, AvailabilityStatus::WORKING_REMOTE);
        }
    }

    private static function withinGeofence(UserLocation $location, float $lat, float $lng, float $accuracyM = 0): bool
    {
        $buffer = min(max(0.0, $accuracyM), 150.0);

        return $location->distanceTo($lat, $lng) <= (float) ($location->radius_m ?: 100) + $buffer;
    }

    /** Optional custom status message without changing primary status. */
    public static function setMessage(User $user, ?string $message): UserPresence
    {
        $presence = UserPresence::firstOrCreate(['user_id' => $user->id]);
        $presence->status_message = $message ? mb_substr(trim($message), 0, 140) : null;
        $presence->save();
        self::announce($user, self::payloadFromPresence($presence, $presence->isOnline()));

        return $presence;
    }

    /**
     * Presence payload for a viewer, extending the existing online/last-seen shape.
     *
     * @return array<string, mixed>
     */
    public static function forViewer(User $subject, User $viewer, ?UserPresence $presence = null): array
    {
        $base = PresenceService::forViewer($subject, $viewer, $presence);

        if (! MessagingSettings::allowsVisibility($subject, $viewer, 'onlineStatus')) {
            return $base;
        }

        if ($presence === null && $subject->relationLoaded('presence')) {
            $presence = $subject->presence;
        } elseif ($presence === null) {
            $presence = UserPresence::where('user_id', $subject->id)->first();
        }

        if ($presence) {
            // syncPrimary force-fills and saves THIS instance, so it is already
            // current. The refresh that used to stand here re-read the row from
            // the database for every person in a listing — a whole extra query
            // each to fetch back what we had just written.
            $presence = self::syncPrimary($subject, $presence);
        }

        $online = (bool) ($base['online'] ?? false);
        $status = self::payloadFromPresence($presence, $online);

        return array_merge($base, [
            'status' => $status['status'],
            'statusLabel' => $status['label'],
            'statusSource' => $status['source'],
            'statusMessage' => $status['message'],
            'statusStartedAt' => $status['startedAt']?->toIso8601String(),
            'statusExpiresAt' => $status['expiresAt']?->toIso8601String(),
            'statusIcon' => $status['icon'],
        ]);
    }

    /** @return array<string, mixed> */
    public static function selfPayload(User $user): array
    {
        $presence = UserPresence::firstOrCreate(['user_id' => $user->id]);
        self::recompute($user, $presence);
        $presence->refresh();

        $states = UserPresenceState::where('user_id', $user->id)->get()->map(fn ($s) => [
            'status' => $s->status,
            'source' => $s->source,
            'message' => $s->status_message,
            'startsAt' => $s->starts_at?->toIso8601String(),
            'expiresAt' => $s->expires_at?->toIso8601String(),
            'meta' => $s->meta,
        ])->values()->all();

        $locations = UserLocation::where('user_id', $user->id)->get()->map(fn ($l) => [
            'type' => $l->type,
            'label' => $l->label,
            'address' => $l->address,
            'latitude' => (float) $l->latitude,
            'longitude' => (float) $l->longitude,
            'radiusM' => (int) $l->radius_m,
            'enabled' => (bool) $l->enabled,
        ])->values()->all();

        $schedules = UserStatusSchedule::where('user_id', $user->id)
            ->orderByDesc('starts_at')
            ->get()
            ->map(fn ($s) => [
                'id' => $s->id,
                'status' => $s->status,
                'message' => $s->status_message,
                'startsAt' => $s->starts_at->toIso8601String(),
                'endsAt' => $s->ends_at->toIso8601String(),
                'recurrence' => $s->recurrence,
                'enabled' => (bool) $s->enabled,
            ])->values()->all();

        $primary = self::payloadFromPresence($presence, $presence->isOnline());

        return [
            'primary' => [
                'status' => $primary['status'],
                'source' => $primary['source'],
                'message' => $primary['message'],
                'label' => $primary['label'],
                'icon' => $primary['icon'],
                'startedAt' => $primary['startedAt']?->toIso8601String(),
                'expiresAt' => $primary['expiresAt']?->toIso8601String(),
            ],
            'states' => $states,
            'locations' => $locations,
            'schedules' => $schedules,
            'manualPicks' => AvailabilityStatus::MANUAL_PICKS,
            'allStatuses' => AvailabilityStatus::LABELS,
        ];
    }

    private static function purgeExpired(User $user): void
    {
        $primed = self::primed($user);

        // Nothing of theirs to purge — established for the whole page in one
        // query rather than two deletes each.
        if ($primed !== null && $primed === []) {
            return;
        }

        UserPresenceState::where('user_id', $user->id)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->delete();

        UserPresenceState::where('user_id', $user->id)
            ->whereNotNull('starts_at')
            ->where('starts_at', '>', now())
            ->delete();
    }

    private static function applySchedules(User $user): void
    {
        $active = UserStatusSchedule::where('user_id', $user->id)
            ->where('enabled', true)
            ->where('starts_at', '<=', now())
            ->where('ends_at', '>', now())
            ->orderBy('starts_at')
            ->get();

        foreach ($active as $schedule) {
            self::setState(
                $user,
                $schedule->status,
                AvailabilityStatus::SOURCE_SCHEDULED,
                $schedule->ends_at,
                $schedule->starts_at,
                $schedule->status_message,
            );
        }
    }

    /** @return array{status: string, source: ?string, message: ?string, label: string, icon: string, startedAt: ?Carbon, expiresAt: ?Carbon} */
    private static function resolvePrimary(User $user, bool $online): array
    {
        /*
         * The primed rows answer this without a query. They are pre-purge,
         * which changes nothing: isActive() below rejects exactly what
         * purgeExpired deletes, so the surviving set is the same either way.
         */
        $primed = self::primed($user);
        $rows = $primed !== null ? collect($primed) : UserPresenceState::where('user_id', $user->id)->get();

        $states = $rows
            ->filter(fn ($s) => $s->isActive())
            ->sortBy(fn ($s) => AvailabilityStatus::priorityOf($s->status));

        if ($states->isNotEmpty()) {
            /** @var UserPresenceState $winner */
            $winner = $states->first();

            return [
                'status' => $winner->status,
                'source' => $winner->source,
                'message' => $winner->status_message,
                'label' => AvailabilityStatus::label($winner->status),
                'icon' => AvailabilityStatus::ICONS[$winner->status] ?? 'gray',
                'startedAt' => $winner->starts_at ?? $winner->created_at,
                'expiresAt' => $winner->expires_at,
            ];
        }

        $status = $online ? AvailabilityStatus::ONLINE : AvailabilityStatus::OFFLINE;

        return [
            'status' => $status,
            'source' => $online ? AvailabilityStatus::SOURCE_AUTOMATIC : AvailabilityStatus::SOURCE_SYSTEM,
            'message' => null,
            'label' => AvailabilityStatus::label($status),
            'icon' => AvailabilityStatus::ICONS[$status],
            'startedAt' => null,
            'expiresAt' => null,
        ];
    }

    /** @return array{status: string, source: ?string, message: ?string, label: string, icon: string, startedAt: ?Carbon, expiresAt: ?Carbon} */
    private static function payloadFromPresence(?UserPresence $presence, bool $online): array
    {
        if ($presence && $presence->primary_status) {
            return [
                'status' => $presence->primary_status,
                'source' => $presence->status_source,
                'message' => $presence->status_message,
                'label' => AvailabilityStatus::label($presence->primary_status),
                'icon' => AvailabilityStatus::ICONS[$presence->primary_status] ?? 'gray',
                'startedAt' => $presence->status_started_at,
                'expiresAt' => $presence->status_expires_at,
            ];
        }

        $status = $online ? AvailabilityStatus::ONLINE : AvailabilityStatus::OFFLINE;

        return [
            'status' => $status,
            'source' => $online ? AvailabilityStatus::SOURCE_AUTOMATIC : AvailabilityStatus::SOURCE_SYSTEM,
            'message' => null,
            'label' => AvailabilityStatus::label($status),
            'icon' => AvailabilityStatus::ICONS[$status],
            'startedAt' => null,
            'expiresAt' => null,
        ];
    }

    /** @param  array{status: string, source: ?string, message: ?string, label: string}  $primary */
    private static function announce(User $user, array $primary): void
    {
        if (MessagingSettings::get($user, 'onlineStatus') === MessagingSettings::NOBODY) {
            return;
        }

        Broadcaster::to(new UserStatusChanged($user, $primary));
    }
}
