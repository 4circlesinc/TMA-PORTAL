<?php

namespace App\Support\Calendar\Sync;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Support\Calendar\CalendarAudit;
use Illuminate\Support\Str;

/**
 * Keeps one provider-backed calendar in step with Google or Microsoft.
 *
 * The rules that matter, all from the brief:
 *
 *  - **No duplicates.** A remote event maps to a local row by
 *    (provider, external_calendar_id, external_event_id) — never by title or
 *    date. A partial unique index on those columns is the backstop.
 *  - **Nothing is lost silently.** When both sides changed the same event
 *    since the last sync, the losing version is written to `conflict_snapshot`
 *    and the user is warned, rather than being overwritten and forgotten.
 *  - **A failure stays local to its calendar.** One calendar failing to sync
 *    records an error on that row and moves on; it never blocks the others or
 *    the page.
 *
 * Direction is honoured throughout: an import-only calendar never pushes, an
 * export-only one never pulls.
 */
class CalendarSynchronizer
{
    public function __construct(private Calendar $calendar) {}

    /**
     * Run a full sync cycle: pull remote changes, then push local ones.
     *
     * @return array{pulled: int, pushed: int, deleted: int, conflicts: int}
     */
    public function run(): array
    {
        $account = $this->calendar->connectedAccount;
        if (! $account || ! $this->calendar->external_id) {
            throw new CalendarSyncException('This calendar is not connected to a provider.');
        }

        $provider = ProviderFactory::for($account);

        $this->calendar->forceFill([
            'subscription_status' => 'syncing',
            'subscription_attempted_at' => now(),
        ])->save();

        $stats = ['pulled' => 0, 'pushed' => 0, 'deleted' => 0, 'conflicts' => 0];

        try {
            if ($this->calendar->pullsIn()) {
                $this->pull($provider, $stats);
            }

            if ($this->calendar->pushesOut()) {
                $this->push($provider, $stats);
            }

            $this->calendar->forceFill([
                'subscription_status' => 'ok',
                'subscription_error' => null,
                'subscription_synced_at' => now(),
                'subscription_failures' => 0,
            ])->save();

            CalendarAudit::record(CalendarAudit::SYNC_COMPLETED, null, $this->calendar, context: $stats);
        } catch (CalendarSyncException $e) {
            $this->recordFailure($e->getMessage());
            throw $e;
        }

        return $stats;
    }

    /* ── pull ────────────────────────────────────────────────── */

    /**
     * @param  array<string, int>  $stats
     */
    private function pull(CalendarProvider $provider, array &$stats): void
    {
        $windowStart = ($this->calendar->sync_window_start ?? now()->subMonths(3))->toIso8601String();

        try {
            $result = $provider->changedEvents($this->calendar->external_id, $this->calendar->sync_cursor, $windowStart);
        } catch (CalendarSyncException $e) {
            if (! $e->cursorExpired) {
                throw $e;
            }
            // The token expired: drop it and re-pull the whole window. This is
            // why every apply is an idempotent upsert — a full re-pull must
            // not duplicate what is already here.
            $result = $provider->changedEvents($this->calendar->external_id, null, $windowStart);
        }

        foreach ($result['events'] as $remote) {
            if (($remote['cancelled'] ?? false) && ! $this->calendar->sync_cancelled) {
                // A cancellation we don't mirror is treated as a removal.
                $this->applyDeletion($remote['externalId'], $stats);

                continue;
            }

            $this->applyRemote($remote, $stats);
        }

        foreach ($result['deleted'] as $externalId) {
            $this->applyDeletion($externalId, $stats);
        }

        $this->calendar->forceFill(['sync_cursor' => $result['cursor']])->save();
    }

    /**
     * Fold one remote event into the calendar.
     *
     * @param  array<string, mixed>  $remote
     * @param  array<string, int>  $stats
     */
    private function applyRemote(array $remote, array &$stats): void
    {
        $local = CalendarEvent::where('calendar_id', $this->calendar->id)
            ->where('external_event_id', $remote['externalId'])
            ->first();

        $attributes = RemoteEvent::toAttributes($remote, $this->calendar);

        $remoteFingerprint = RemoteEvent::fingerprint($remote);

        if (! $local) {
            $created = CalendarEvent::create($attributes + [
                'uuid' => (string) Str::uuid(),
                'calendar_id' => $this->calendar->id,
                'organizer_id' => $this->calendar->owner_id,
                'created_by' => $this->calendar->owner_id,
                'external_provider' => $this->calendar->source,
                'external_calendar_id' => $this->calendar->external_id,
                'external_event_id' => $remote['externalId'],
                'external_etag' => $remote['etag'] ?? null,
                'external_synced_at' => now(),
                'external_synced_local_at' => now(),
            ]);
            // The baseline the next sync compares against.
            $created->forceFill(['external_local_fingerprint' => $remoteFingerprint])->saveQuietly();
            $stats['pulled']++;

            return;
        }

        /*
         * The event exists both sides. Whether it changed locally is decided
         * by content, not by a timestamp — comparing the current fingerprint
         * to the one stored at the last sync. That is immune to clock
         * precision: an edit and a sync in the same second would otherwise
         * read as unchanged and lose the edit.
         */
        $localFingerprint = RemoteEvent::fingerprintEvent($local);
        $changedLocally = $local->external_local_fingerprint !== null
            && $localFingerprint !== $local->external_local_fingerprint;

        $remoteChanged = $remoteFingerprint !== ($local->external_local_fingerprint ?? $localFingerprint);

        if ($changedLocally && $remoteChanged) {
            $this->recordConflict($local, $remote, $stats);

            return;
        }

        if (! $remoteChanged) {
            // Provider re-sent an unchanged event; just refresh sync markers.
            $local->forceFill([
                'external_etag' => $remote['etag'] ?? $local->external_etag,
                'external_synced_at' => now(),
            ])->saveQuietly();

            return;
        }

        // Clean remote update wins.
        $local->fill($attributes);
        $local->external_etag = $remote['etag'] ?? null;
        $local->external_synced_at = now();
        $local->external_synced_local_at = now();
        $local->external_local_fingerprint = $remoteFingerprint;
        $local->save();
        $stats['pulled']++;
    }

    /**
     * @param  array<string, int>  $stats
     */
    private function applyDeletion(string $externalId, array &$stats): void
    {
        $local = CalendarEvent::where('calendar_id', $this->calendar->id)
            ->where('external_event_id', $externalId)
            ->first();

        if ($local) {
            $local->delete();
            $stats['deleted']++;
        }
    }

    /**
     * Both sides changed. The remote is applied (most-recent-valid-update
     * wins, and the pull is the fresher read), but the local version is
     * preserved in `conflict_snapshot` so nothing is lost and the user can
     * restore it.
     *
     * @param  array<string, mixed>  $remote
     * @param  array<string, int>  $stats
     */
    private function recordConflict(CalendarEvent $local, array $remote, array &$stats): void
    {
        $local->conflict_snapshot = [
            'title' => $local->title,
            'description' => $local->description,
            'location' => $local->location,
            'startsAt' => $local->starts_at->toIso8601String(),
            'endsAt' => $local->ends_at->toIso8601String(),
            'savedAt' => $local->updated_at?->toIso8601String(),
        ];
        $local->conflict_at = now();

        $local->fill(RemoteEvent::toAttributes($remote, $this->calendar));
        $local->external_etag = $remote['etag'] ?? null;
        $local->external_synced_at = now();
        $local->external_synced_local_at = now();
        // The remote is now the agreed baseline; the discarded local version
        // lives on in conflict_snapshot.
        $local->external_local_fingerprint = RemoteEvent::fingerprint($remote);
        $local->save();

        $stats['conflicts']++;
        CalendarAudit::record(CalendarAudit::CONFLICT_DETECTED, null, $this->calendar, $local);
    }

    /* ── push ────────────────────────────────────────────────── */

    /**
     * @param  array<string, int>  $stats
     */
    private function push(CalendarProvider $provider, array &$stats): void
    {
        /*
         * Candidates: anything not yet on the provider, plus a cheap
         * timestamp prefilter for possibly-changed events. The definitive
         * "did it actually change" test is by fingerprint below, so this query
         * can safely over-select — a false positive costs one idempotent
         * no-op push, never a lost change.
         */
        $pending = CalendarEvent::where('calendar_id', $this->calendar->id)
            ->where(function ($q) {
                $q->whereNull('external_event_id')
                    ->orWhereColumn('updated_at', '>=', 'external_synced_local_at')
                    ->orWhereNull('external_synced_local_at');
            })
            ->whereNull('conflict_at')
            ->limit(200)
            ->get();

        foreach ($pending as $event) {
            $fingerprint = RemoteEvent::fingerprintEvent($event);

            // Already pushed and unchanged since — skip the redundant call.
            if ($event->external_event_id && $fingerprint === $event->external_local_fingerprint) {
                continue;
            }

            $payload = RemoteEvent::fromEvent($event);

            if ($event->external_event_id) {
                $result = $provider->updateEvent(
                    $this->calendar->external_id,
                    $event->external_event_id,
                    $payload,
                    $event->external_etag,
                );
            } else {
                $created = $provider->createEvent($this->calendar->external_id, $payload);
                $event->external_provider = $this->calendar->source;
                $event->external_calendar_id = $this->calendar->external_id;
                $event->external_event_id = $created['externalId'];
                $result = ['etag' => $created['etag']];
            }

            // saveQuietly so bumping the sync markers doesn't tick updated_at
            // and make the event look changed-again on the next push. The
            // fingerprint we just pushed becomes the agreed baseline.
            $event->external_etag = $result['etag'] ?? null;
            $event->external_synced_at = now();
            $event->external_synced_local_at = now();
            $event->external_local_fingerprint = $fingerprint;
            $event->saveQuietly();

            $stats['pushed']++;
        }
    }

    private function recordFailure(string $message): void
    {
        $failures = (int) $this->calendar->subscription_failures + 1;

        $this->calendar->forceFill([
            'subscription_status' => 'error',
            'subscription_error' => mb_substr($message, 0, 500),
            'subscription_failures' => $failures,
        ])->save();

        CalendarAudit::record(CalendarAudit::SYNC_FAILED, null, $this->calendar, context: ['error' => $message]);
    }
}
