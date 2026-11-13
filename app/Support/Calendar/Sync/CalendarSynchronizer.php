<?php

namespace App\Support\Calendar\Sync;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\Notification;
use App\Support\Calendar\CalendarAudit;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Str;

/**
 * Keeps one provider-backed calendar in step with Google or Microsoft.
 *
 * The rules that matter, all from the brief:
 *
 *  - **No duplicates.** A remote event maps to a local row by
 *    (provider, external_calendar_id, external_event_id), never by title or
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
    /**
     * Runs in a row the provider may fail to answer (CalendarSyncException
     * ::$transient) before the calendar is called failed and its owner told.
     * Until then the job asks again a few minutes later and the calendar
     * keeps the state it had.
     */
    public const TRANSIENT_RUNS_BEFORE_ERROR = 3;

    /** How far back a re-pull reaches: anything older is already here. */
    private const REPULL_MONTHS_BACK = 3;

    /** Days a Graph delta round is followed before a new one moves its range on. */
    private const ROUND_DAYS = 30;

    public function __construct(private Calendar $calendar) {}

    /**
     * Run a full sync cycle: pull remote changes, then push local ones.
     *
     * @return array{pulled: int, pushed: int, deleted: int, conflicts: int, failed: int}
     */
    public function run(): array
    {
        $account = $this->calendar->connectedAccount;
        if (! $account || ! $this->calendar->external_id) {
            throw new CalendarSyncException('This calendar is not connected to a provider.');
        }

        $provider = ProviderFactory::for($account);

        // What the calendar showed before this run, put back if the provider
        // merely fails to answer: one 502 is not news for the owner.
        $before = [
            'subscription_status' => $this->calendar->subscription_status,
            'subscription_error' => $this->calendar->subscription_error,
        ];

        $this->calendar->forceFill([
            'subscription_status' => 'syncing',
            'subscription_attempted_at' => now(),
            'subscription_error' => null,
        ])->save();

        $stats = ['pulled' => 0, 'pushed' => 0, 'deleted' => 0, 'conflicts' => 0, 'failed' => 0];

        try {
            // One-time heal for calendars connected before remote_can_write existed.
            $this->refreshRemoteWriteability($provider);

            if ($this->calendar->pullsIn()) {
                $this->pull($provider, $stats);
            }

            // Read-only remotes (holidays etc.) never push, pushesOut() already
            // gates on remote_can_write === false.
            if ($this->calendar->pushesOut()) {
                $this->push($provider, $stats);
            }

            $this->finishRun($stats);
        } catch (CalendarSyncException $e) {
            if ($e->throttled || CalendarSyncException::looksThrottled($e->getMessage())) {
                throw $e;
            }

            $failures = (int) $this->calendar->subscription_failures + 1;
            if ($e->transient && $failures < self::TRANSIENT_RUNS_BEFORE_ERROR) {
                // Counted, so a provider that stays down is reported on the
                // third run, but not yet shown: the job asks again shortly.
                $this->calendar->forceFill($before + ['subscription_failures' => $failures])->save();

                throw $e;
            }

            $this->recordFailure($e->getMessage());
            throw $e;
        }

        return $stats;
    }

    /**
     * The calendar synced: an unread "Calendar sync failed" in its owner's
     * bell is about a problem that has gone, and only confuses.
     */
    public static function clearFailureNotice(Calendar $calendar): void
    {
        $ownerId = $calendar->owner_id ?? $calendar->connectedAccount?->user_id;
        if (! $ownerId) {
            return;
        }

        Notification::query()
            ->where('user_id', $ownerId)
            ->where('dedupe_key', 'calendar.sync_error:'.$calendar->id)
            ->where('type', 'calendar.sync_error')
            ->whereNull('read_at')
            ->update(['read_at' => now()]);
    }

    /**
     * Fill remote_can_write for legacy rows and force import-only when the
     * provider reports the calendar as read-only (holiday calendars, etc.).
     */
    private function refreshRemoteWriteability(CalendarProvider $provider): void
    {
        if ($this->calendar->remote_can_write !== null) {
            return;
        }

        try {
            foreach ($provider->listCalendars() as $remote) {
                if ((string) ($remote['id'] ?? '') !== (string) $this->calendar->external_id) {
                    continue;
                }

                $canWrite = ! empty($remote['canWrite']);
                $updates = ['remote_can_write' => $canWrite];
                if (! $canWrite) {
                    $updates['sync_direction'] = 'import';
                }
                $this->calendar->forceFill($updates)->save();

                return;
            }
        } catch (CalendarSyncException $e) {
            if ($e->throttled) {
                throw $e;
            }
            // Discovery failed, leave null and continue the sync; a later
            // run can heal once the provider is reachable again.
        }
    }

    /**
     * Mark the calendar ok or partially synchronized after a completed run.
     *
     * @param  array<string, int>  $stats
     */
    private function finishRun(array $stats): void
    {
        $failed = (int) ($stats['failed'] ?? 0);
        $conflicts = (int) ($stats['conflicts'] ?? 0);

        if ($failed > 0 || $conflicts > 0) {
            $parts = [];
            if ($failed > 0) {
                $parts[] = $failed === 1
                    ? '1 event could not be synchronized'
                    : $failed.' events could not be synchronized';
            }
            if ($conflicts > 0) {
                $parts[] = $conflicts === 1
                    ? '1 conflict needs review'
                    : $conflicts.' conflicts need review';
            }

            $this->calendar->forceFill([
                'subscription_status' => 'partial',
                'subscription_error' => implode('. ', $parts),
                'subscription_synced_at' => now(),
                'subscription_failures' => 0,
            ])->save();
        } else {
            $this->calendar->forceFill([
                'subscription_status' => 'ok',
                'subscription_error' => null,
                'subscription_synced_at' => now(),
                'subscription_failures' => 0,
            ])->save();
        }

        self::clearFailureNotice($this->calendar);

        CalendarAudit::record(CalendarAudit::SYNC_COMPLETED, null, $this->calendar, context: $stats);
    }

    /* ── pull ────────────────────────────────────────────────── */

    /**
     * @param  array<string, int>  $stats
     */
    private function pull(CalendarProvider $provider, array &$stats): void
    {
        $windowStart = $this->calendar->sync_window_start ?? now()->subMonths(3);

        /*
         * The first import reaches as far back as the person asked. A re-pull
         * (expired token, or the wedge below) only needs recent months: the
         * older events are already here, and every month of window is more
         * recurring instances for Exchange to expand, which is what makes
         * Graph's gateway give up with a 502 on a wide calendar view.
         */
        if ($this->calendar->subscription_synced_at !== null) {
            $windowStart = $windowStart->max(now()->subMonths(self::REPULL_MONTHS_BACK));
        }
        $windowStart = $windowStart->toIso8601String();
        $cursor = $this->calendar->sync_cursor;

        try {
            $this->pullRound($provider, $cursor, $windowStart, $stats);
        } catch (CalendarSyncException $e) {
            if (! $e->cursorExpired && ! $this->cursorLooksWedged($e, $cursor)) {
                throw $e;
            }
            // The token expired, or the provider keeps failing on it: drop it
            // and re-pull the whole window. This is why every apply is an
            // idempotent upsert, a full re-pull must not duplicate what is
            // already here. The stored cursor is only replaced once the
            // fresh pass lands a page.
            $this->pullRound($provider, null, $windowStart, $stats);

            return;
        }

        /*
         * Graph's delta link keeps the date range of the request that began
         * its round: followed for ever, it would never see past the six
         * months ahead it was minted with. Once a month, with this run's
         * changes (deletions too) already in, a new round starts over
         * today's range. If it cannot finish now, the next run resumes it.
         */
        if ($cursor !== null && $this->roundIsDueToRoll()) {
            try {
                $this->pullRound($provider, null, $windowStart, $stats);
            } catch (CalendarSyncException $e) {
                if ($e->throttled) {
                    throw $e;
                }
            }
        }
    }

    /**
     * One pass over the provider's changes from `$cursor`, or a new round
     * from scratch when it is null.
     *
     * Pages are applied and the cursor persisted as they arrive, so a run
     * killed mid-pull (timeout, worker restart) resumes from the last page
     * it finished instead of losing the whole pass - which on a big first
     * import meant a run that could never finish. Providers that ignore the
     * callback still return everything in the arrays, handled below; real
     * providers return them empty when streaming.
     *
     * @param  array<string, int>  $stats
     */
    private function pullRound(CalendarProvider $provider, ?string $cursor, string $windowStart, array &$stats): void
    {
        $startedAt = $cursor === null ? now() : null;

        $onPage = function (array $events, array $deleted, ?string $resumeCursor) use (&$stats, $startedAt): void {
            $this->applyPage($events, $deleted, $stats);
            $this->keepCursor($resumeCursor, $startedAt);
        };

        $result = $provider->changedEvents($this->calendar->external_id, $cursor, $windowStart, $onPage);

        $this->applyPage($result['events'], $result['deleted'], $stats);
        $this->keepCursor($result['cursor'], $startedAt);
    }

    /** A new round is dated when its first page lands, not when it is asked for. */
    private function keepCursor(?string $cursor, ?\DateTimeInterface $roundStartedAt): void
    {
        if ($cursor === null) {
            return;
        }

        $this->calendar->forceFill(array_filter([
            'sync_cursor' => $cursor,
            'sync_round_started_at' => $roundStartedAt,
        ]))->save();
    }

    /** Only Graph pins a range into its token; Google's sync token has none. */
    private function roundIsDueToRoll(): bool
    {
        if ($this->calendar->source !== Calendar::SOURCE_MICROSOFT) {
            return false;
        }

        $started = $this->calendar->sync_round_started_at;

        return $started === null || $started->lte(now()->subDays(self::ROUND_DAYS));
    }

    /**
     * A stored cursor the provider keeps failing on, rather than a provider
     * that is down. A run killed mid-pass leaves Graph's nextLink as the
     * cursor, and Graph can stop serving one without saying it expired: it
     * answers 502 every time, and every run asked for that same link, so the
     * calendar never synced again. A second failing run in a row goes fresh;
     * a single blip keeps the token, since a fresh pass cannot see what was
     * deleted in the meantime.
     */
    private function cursorLooksWedged(CalendarSyncException $e, ?string $cursor): bool
    {
        return $e->transient
            && $cursor !== null
            && (int) $this->calendar->subscription_failures > 0;
    }

    /**
     * @param  array<int, array<string, mixed>>  $events
     * @param  array<int, string>  $deleted
     * @param  array<string, int>  $stats
     */
    private function applyPage(array $events, array $deleted, array &$stats): void
    {
        foreach ($events as $remote) {
            if (($remote['cancelled'] ?? false) && ! $this->calendar->sync_cancelled) {
                // A cancellation we don't mirror is treated as a removal.
                $this->applyDeletion($remote['externalId'], $stats);

                continue;
            }

            $this->applyRemote($remote, $stats);
        }

        foreach ($deleted as $externalId) {
            $this->applyDeletion($externalId, $stats);
        }
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
         * by content, not by a timestamp, comparing the current fingerprint
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

        $ownerId = $this->calendar->owner_id ?? $this->calendar->connectedAccount?->user_id;
        if ($ownerId) {
            Notifier::send([
                'user' => $ownerId,
                'type' => 'calendar.conflict',
                'title' => 'Calendar sync conflict',
                'message' => mb_substr(
                    ($this->calendar->name ? $this->calendar->name.': ' : '').
                    ($local->title ?: 'An event').' was updated in both places. Open Calendar to review.',
                    0,
                    280
                ),
                'subject' => $local,
                'action_url' => '/calendar',
                'dedupe_key' => 'calendar.conflict:'.$local->id,
                'dedupe_minutes' => 30,
            ]);
        }
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
         * can safely over-select, a false positive costs one idempotent
         * no-op push, never a lost change.
         */
        $pending = CalendarEvent::where('calendar_id', $this->calendar->id)
            ->where(function ($q) {
                // Strictly newer than the last push: with >=, every imported
                // row whose two stamps landed in the same tick re-qualified
                // on every run, and enough of those could crowd new local
                // events out of the unordered limit for ever.
                $q->whereNull('external_event_id')
                    ->orWhereColumn('updated_at', '>', 'external_synced_local_at')
                    ->orWhereNull('external_synced_local_at');
            })
            ->whereNull('conflict_at')
            ->orderBy('updated_at')
            ->limit(200)
            ->get();

        foreach ($pending as $event) {
            $fingerprint = RemoteEvent::fingerprintEvent($event);

            // Already pushed and unchanged since, skip the redundant call.
            if ($event->external_event_id && $fingerprint === $event->external_local_fingerprint) {
                continue;
            }

            $payload = RemoteEvent::fromEvent($event);

            try {
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
            } catch (CalendarSyncException $e) {
                if ($e->throttled) {
                    throw $e;
                }
                // One event must not fail the whole calendar (e.g. a single
                // rejected write on an otherwise healthy sync).
                $stats['failed'] = ($stats['failed'] ?? 0) + 1;
            }
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

        $ownerId = $this->calendar->owner_id ?? $this->calendar->connectedAccount?->user_id;
        if ($ownerId) {
            Notifier::send([
                'user' => $ownerId,
                'type' => 'calendar.sync_error',
                'title' => 'Calendar sync failed',
                'message' => mb_substr(($this->calendar->name ? $this->calendar->name.': ' : '').$message, 0, 280),
                'subject' => $this->calendar,
                'action_url' => '/calendar',
                'dedupe_key' => 'calendar.sync_error:'.$this->calendar->id,
                'dedupe_minutes' => 60,
            ]);
        }
    }
}
