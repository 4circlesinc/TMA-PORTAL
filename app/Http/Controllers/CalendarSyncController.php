<?php

namespace App\Http\Controllers;

use App\Jobs\SyncProviderCalendar;
use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Support\Calendar\CalendarAccess;
use App\Support\Calendar\CalendarAudit;
use App\Support\Calendar\CalendarColours;
use App\Support\Calendar\CalendarImporter;
use App\Support\Calendar\CalendarProvisioner;
use App\Support\Calendar\Sync\CalendarSyncException;
use App\Support\Calendar\Sync\ProviderFactory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Connecting Google and Microsoft calendars, and everything the connected
 * ones then need: choosing which to add, setting the sync direction, kicking a
 * sync, resolving conflicts, and disconnecting.
 *
 * The connect flow itself (OAuth, storing the refresh token and granted
 * scopes) is SocialAuthController's job; by the time anyone reaches here the
 * account already exists. This is purely calendar wiring on top of it.
 */
class CalendarSyncController extends Controller
{
    /**
     * The signed-in user's connected accounts and whether each can sync
     * calendars — what the "Connect a calendar" screen reads.
     */
    public function accounts(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot connect calendars.');

        $accounts = ConnectedAccount::where('user_id', $user->id)
            ->whereIn('provider', ['google', 'microsoft'])
            ->get()
            ->map(fn (ConnectedAccount $a) => [
                'id' => $a->id,
                'provider' => $a->provider,
                'email' => $a->email,
                'canRead' => $a->canReadCalendar(),
                // Drives the "reconnect for two-way" prompt.
                'canWrite' => $a->canWriteCalendar(),
            ]);

        return response()->json([
            'accounts' => $accounts,
            // Whether the provider integrations are switched on at all.
            'googleEnabled' => (bool) config('services.google.sync'),
            'microsoftEnabled' => (bool) config('services.microsoft.sync'),
        ]);
    }

    /**
     * The provider-side calendars an account can see, minus the ones already
     * connected — the picker on the connect screen.
     */
    public function providerCalendars(Request $request, int $accountId): JsonResponse
    {
        $user = $request->user();
        $account = $this->account($user, $accountId);

        abort_unless($account->canReadCalendar(), 422,
            'This connection cannot read calendars — reconnect and allow calendar access.');

        try {
            $calendars = ProviderFactory::for($account)->listCalendars();
        } catch (CalendarSyncException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $connected = Calendar::where('connected_account_id', $account->id)
            ->pluck('external_id')
            ->all();

        $available = collect($calendars)
            ->reject(fn (array $c) => in_array($c['id'], $connected, true))
            ->values();

        return response()->json([
            'calendars' => $available,
            'canWrite' => $account->canWriteCalendar(),
        ]);
    }

    /**
     * Connect a provider calendar: create the local mirror and queue the
     * first sync. Events arrive in the background, so the request returns at
     * once rather than waiting on the provider.
     */
    public function connect(Request $request, int $accountId): JsonResponse
    {
        $user = $request->user();
        $account = $this->account($user, $accountId);

        abort_unless($account->canReadCalendar(), 422,
            'This connection cannot read calendars — reconnect and allow calendar access.');

        $data = $request->validate([
            'externalId' => ['required', 'string', 'max:512'],
            'name' => ['required', 'string', 'max:255'],
            'colour' => ['sometimes', Rule::in(CalendarColours::keys())],
            'direction' => ['sometimes', Rule::in(['two_way', 'import', 'export'])],
            // How far back the first import reaches.
            'monthsBack' => ['sometimes', 'integer', 'min:1', 'max:60'],
        ]);

        // Can't push without write scope, whatever was asked for.
        $direction = $data['direction'] ?? 'two_way';
        if (in_array($direction, ['two_way', 'export'], true) && ! $account->canWriteCalendar()) {
            $direction = 'import';
        }

        // Never connect the same provider calendar twice for one account.
        $existing = Calendar::where('connected_account_id', $account->id)
            ->where('external_id', $data['externalId'])
            ->first();

        if ($existing) {
            return response()->json(['message' => 'That calendar is already connected.'], 422);
        }

        // Resolve remote writeability (holidays / subscribed calendars).
        $remoteCanWrite = $this->remoteCanWrite($account, $data['externalId']);
        if (! $remoteCanWrite) {
            $direction = 'import';
        }

        $calendar = Calendar::create([
            'uuid' => (string) Str::uuid(),
            'name' => $data['name'],
            'colour' => $data['colour'] ?? CalendarColours::DEFAULT,
            'calendar_type' => Calendar::TYPE_PERSONAL,
            'owner_id' => $user->id,
            'created_by' => $user->id,
            'timezone' => CalendarProvisioner::defaultTimezone($user),
            'visibility' => 'private',
            'source' => $account->provider,
            'connected_account_id' => $account->id,
            'external_id' => $data['externalId'],
            'sync_direction' => $direction,
            'remote_can_write' => $remoteCanWrite,
            'sync_window_start' => now()->subMonths($data['monthsBack'] ?? 3),
            'subscription_status' => 'syncing',
        ]);

        CalendarProvisioner::subscribe($user, $calendar);
        CalendarAudit::record(CalendarAudit::CALENDAR_CONNECTED, $user, $calendar, context: ['provider' => $account->provider]);

        SyncProviderCalendar::dispatch($calendar->id);

        return response()->json([
            'calendar' => $calendar->fresh(['owner', 'connectedAccount'])
                ->toRecord($user, CalendarAccess::ROLE_OWNER, null),
        ]);
    }

    /**
     * One-click connect: discover every calendar the account can see, add each
     * that is not already mirrored, and queue background sync for all of them.
     * The user never authorises calendars one-by-one after the account OAuth.
     */
    public function connectAll(Request $request, int $accountId): JsonResponse
    {
        $user = $request->user();
        $account = $this->account($user, $accountId);

        abort_unless($account->canReadCalendar(), 422,
            'This connection cannot read calendars — reconnect and allow calendar access.');

        $data = $request->validate([
            'direction' => ['sometimes', Rule::in(['two_way', 'import', 'export'])],
            'monthsBack' => ['sometimes', 'integer', 'min:1', 'max:60'],
        ]);

        try {
            $result = CalendarImporter::importAll(
                $user,
                $account,
                $data['direction'] ?? 'two_way',
                $data['monthsBack'] ?? 3,
            );
        } catch (CalendarSyncException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $added = array_map(
            fn (Calendar $calendar) => $calendar->fresh(['owner', 'connectedAccount'])
                ->toRecord($user, CalendarAccess::ROLE_OWNER, null),
            $result['added'],
        );

        return response()->json([
            'calendarsFound' => $result['found'],
            'calendarsAdded' => count($added),
            'calendarsSkipped' => $result['skipped'],
            'calendarsFailed' => $result['failed'],
            'calendars' => $added,
            'account' => [
                'id' => $account->id,
                'provider' => $account->provider,
                'email' => $account->email,
            ],
        ]);
    }

    /**
     * Aggregate sync progress for one connected account (or every provider
     * calendar the user owns). Safe to poll while the user leaves the page —
     * sync jobs keep running on the queue.
     */
    public function syncStatus(Request $request, ?int $accountId = null): JsonResponse
    {
        $user = $request->user();
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot view calendar sync status.');

        $query = Calendar::query()
            ->where('owner_id', $user->id)
            ->whereIn('source', [Calendar::SOURCE_GOOGLE, Calendar::SOURCE_MICROSOFT])
            ->whereNotNull('connected_account_id');

        if ($accountId) {
            $this->account($user, $accountId);
            $query->where('connected_account_id', $accountId);
        }

        $calendars = $query->withCount('events')->get();

        $rows = $calendars->map(function (Calendar $c) {
            return [
                'id' => $c->uuid,
                'name' => $c->name,
                'status' => $c->subscription_status ?: 'ok',
                'error' => $c->subscription_error,
                'eventCount' => (int) $c->events_count,
                'syncedAt' => $c->subscription_synced_at?->toIso8601String(),
                'attemptedAt' => $c->subscription_attempted_at?->toIso8601String(),
            ];
        })->values();

        $syncing = $rows->where('status', 'syncing')->count();
        $ok = $rows->where('status', 'ok')->count();
        $partial = $rows->where('status', 'partial')->count();
        $error = $rows->where('status', 'error')->count();
        $eventsImported = (int) $rows->sum('eventCount');
        $lastSynced = $calendars->max('subscription_synced_at');

        $stage = 'idle';
        if ($syncing > 0) {
            $stage = 'importing';
        } elseif ($error > 0 && ($ok > 0 || $partial > 0)) {
            $stage = 'partial';
        } elseif ($error > 0 && $ok === 0 && $partial === 0) {
            $stage = 'failed';
        } elseif ($partial > 0 && $error === 0) {
            $stage = 'partial';
        } elseif ($ok > 0 || $partial > 0) {
            $stage = 'complete';
        }

        return response()->json([
            'stage' => $stage,
            'calendarsFound' => $rows->count(),
            'calendarsAdded' => $rows->count(),
            'calendarsSyncing' => $syncing,
            'calendarsOk' => $ok,
            'calendarsPartial' => $partial,
            'calendarsError' => $error,
            'eventsImported' => $eventsImported,
            'lastSyncedAt' => $lastSynced?->toIso8601String(),
            'calendars' => $rows,
        ]);
    }

    /** Change how a connected calendar syncs, or force a sync now. */
    public function updateSync(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'edit_calendar'), 403, 'You cannot change this calendar.');
        abort_unless($calendar->isProviderSynced(), 422, 'That calendar is not connected to a provider.');

        $data = $request->validate([
            'direction' => ['sometimes', Rule::in(['two_way', 'import', 'export'])],
            'syncCancelled' => ['sometimes', 'boolean'],
        ]);

        if (isset($data['direction'])) {
            $wantsWrite = in_array($data['direction'], ['two_way', 'export'], true);
            abort_if(
                $wantsWrite && ! $calendar->connectedAccount?->canWriteCalendar(),
                422,
                'Reconnect with calendar write access to push events out.',
            );
            abort_if(
                $wantsWrite && $calendar->remote_can_write === false,
                422,
                'This calendar is read-only on the provider and can only import.',
            );
            $calendar->sync_direction = $data['direction'];
        }

        if (array_key_exists('syncCancelled', $data)) {
            $calendar->sync_cancelled = $data['syncCancelled'];
        }

        $calendar->save();

        return response()->json([
            'calendar' => $calendar->fresh(['owner', 'connectedAccount'])
                ->toRecord($user, CalendarAccess::role($user, $calendar) ?? CalendarAccess::ROLE_OWNER, null),
        ]);
    }

    public function sync(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'edit_calendar'), 403, 'You cannot sync this calendar.');
        abort_unless($calendar->isProviderSynced(), 422, 'That calendar is not connected to a provider.');

        // Clear the back-off — the user asked, so retry now.
        $calendar->forceFill(['subscription_status' => 'syncing', 'subscription_failures' => 0])->save();

        SyncProviderCalendar::dispatch($calendar->id);

        return response()->json(['status' => 'ok']);
    }

    /**
     * Disconnect a provider calendar. The events already pulled in are kept by
     * default (they become a plain local calendar); `purge` removes them too.
     */
    public function disconnect(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'edit_calendar'), 403, 'You cannot disconnect this calendar.');
        abort_unless($calendar->isProviderSynced(), 422, 'That calendar is not connected to a provider.');

        if ($request->boolean('purge')) {
            $calendar->events()->delete();
            $calendar->delete();
        } else {
            // Keep the events as a normal local calendar; just cut the link.
            $calendar->forceFill([
                'source' => Calendar::SOURCE_LOCAL,
                'connected_account_id' => null,
                'external_id' => null,
                'sync_cursor' => null,
                'subscription_status' => null,
                'subscription_error' => null,
            ])->save();
        }

        CalendarAudit::record(CalendarAudit::CALENDAR_DISCONNECTED, $user, $calendar);

        return response()->json(['status' => 'ok']);
    }

    /* ── conflicts ───────────────────────────────────────────── */

    /** Events on this calendar that changed in both places. */
    public function conflicts(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'view_details'), 403, 'You cannot view this calendar.');

        $conflicts = CalendarEvent::where('calendar_id', $calendar->id)
            ->whereNotNull('conflict_at')
            ->orderByDesc('conflict_at')
            ->get()
            ->map(fn (CalendarEvent $e) => [
                'id' => $e->uuid,
                // What is live now (the remote version that was applied).
                'current' => [
                    'title' => $e->title,
                    'startsAt' => $e->starts_at->toIso8601String(),
                    'endsAt' => $e->ends_at->toIso8601String(),
                    'location' => $e->location,
                ],
                // What was overwritten, preserved so it can be restored.
                'yours' => $e->conflict_snapshot,
                'at' => $e->conflict_at->toIso8601String(),
            ]);

        return response()->json(['conflicts' => $conflicts]);
    }

    /**
     * Resolve a conflict by keeping either the remote version already applied
     * ('theirs') or restoring the local one that was overwritten ('yours').
     */
    public function resolveConflict(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $event = CalendarEvent::where('uuid', $uuid)->with('calendar')->firstOrFail();

        abort_unless($this->canWriteEvent($user, $event), 403, 'You cannot change this event.');
        abort_if($event->conflict_at === null, 422, 'That event has no conflict to resolve.');

        $keep = $request->validate([
            'keep' => ['required', Rule::in(['yours', 'theirs'])],
        ])['keep'];

        if ($keep === 'yours' && $event->conflict_snapshot) {
            $snapshot = $event->conflict_snapshot;
            $event->fill([
                'title' => $snapshot['title'],
                'description' => $snapshot['description'] ?? null,
                'location' => $snapshot['location'] ?? null,
                'starts_at' => $snapshot['startsAt'],
                'ends_at' => $snapshot['endsAt'],
            ]);
            // Restoring the local version means it must be pushed out again, so
            // the sync markers are left stale on purpose — the next push picks
            // it up.
            $event->external_synced_local_at = null;
        }

        $event->conflict_snapshot = null;
        $event->conflict_at = null;
        $event->save();

        // Queue a sync so the resolution propagates.
        if ($event->calendar->isProviderSynced()) {
            SyncProviderCalendar::dispatch($event->calendar->id);
        }

        return response()->json(['status' => 'ok']);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function account(User $user, int $accountId): ConnectedAccount
    {
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot connect calendars.');

        return ConnectedAccount::where('user_id', $user->id)
            ->whereIn('provider', ['google', 'microsoft'])
            ->findOrFail($accountId);
    }

    /** Look up whether a remote calendar accepts writes; defaults true if unknown. */
    private function remoteCanWrite(ConnectedAccount $account, string $externalId): bool
    {
        try {
            $remote = collect(ProviderFactory::for($account)->listCalendars())
                ->first(fn (array $c) => ($c['id'] ?? null) === $externalId);

            if ($remote === null) {
                return true;
            }

            return ! empty($remote['canWrite']);
        } catch (\Throwable) {
            // Provider lookup is best-effort at connect time; don't block connect.
            return true;
        }
    }

    private function find(string $uuid): Calendar
    {
        return Calendar::where('uuid', $uuid)->firstOrFail();
    }

    private function canWriteEvent(User $user, CalendarEvent $event): bool
    {
        return CalendarAccess::can($user, $event->calendar, 'edit_events')
            || (CalendarAccess::can($user, $event->calendar, 'add_events') && $event->created_by === $user->id);
    }
}
