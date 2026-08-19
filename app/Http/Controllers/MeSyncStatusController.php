<?php

namespace App\Http\Controllers;

use App\Models\Calendar;
use App\Models\MailMessage;
use App\Models\SharePointConnection;
use App\Models\SmartsheetAttachment;
use App\Support\Access\Role;
use App\Support\Cbi\DocumentImporter;
use App\Support\Cbi\SyncActor;
use App\Support\Imports\ImportPause;
use App\Support\Mail\Mailbox;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * One aggregate answer to "is my stuff syncing?" — email, calendar,
 * OneDrive and (for admins) Smartsheet document import in a single poll.
 * Drives the bottom-right sync toasts that appear right after connecting.
 * Each state is derived from the same records the feature pages read, so
 * the toasts never disagree with the pages; the heavier per-page status
 * endpoints (stall diagnosis, per-folder counts) stay where they are.
 *
 * States per service: off | syncing | done | error.
 */
class MeSyncStatusController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'importsPaused' => ImportPause::any(),
            'email' => $this->guard(fn () => $this->email($user)),
            'calendar' => $this->guard(fn () => $this->calendar($user)),
            'onedrive' => $this->guard(fn () => $this->withImportPause($this->onedrive($user), ImportPause::onedrive())),
            'smartsheet' => $this->guard(fn () => $this->withImportPause($this->smartsheet($user), ImportPause::smartsheet())),
        ]);
    }

    /** Overlay a per-service pause onto a status payload. */
    private function withImportPause(array $status, bool $paused): array
    {
        if (! $paused) {
            return $status;
        }

        $status['importsPaused'] = true;
        if (($status['state'] ?? null) === 'syncing') {
            $status['state'] = 'paused';
        }

        return $status;
    }

    /*
     * A status poll must never be the thing that breaks. A stored token whose
     * ciphertext no longer matches APP_KEY throws on read, and one throw here
     * used to 500 the whole endpoint — which killed the poll loop and left the
     * sync toast frozen on screen for the rest of the session. Report the
     * service as unhealthy and let the other two answer.
     */
    private function guard(callable $probe): array
    {
        try {
            return $probe();
        } catch (\Throwable $e) {
            report($e);

            return ['state' => 'error'];
        }
    }

    private function email($user): array
    {
        $account = Mailbox::accountFor($user);

        if (! $account || ! $account->sync_email || ! $account->token) {
            return ['state' => 'off'];
        }

        $synced = MailMessage::where('user_id', $user->id)->count();
        $totals = array_map('intval', $account->mail_backfill['_totals'] ?? []);
        $total = $totals === [] ? null : array_sum($totals);

        if ($account->mail_status === 'error') {
            return ['state' => 'error', 'synced' => $synced];
        }

        // The first import is the only pass with a knowable total — it walks a
        // measured mailbox, so the card can show a real percentage.
        if ($account->mail_backfilled_at === null) {
            return ['state' => 'syncing', 'synced' => $synced, 'total' => $total];
        }

        /*
         * Every later pass counts too. Reporting only the first import is why
         * the mailbox had no sync card while OneDrive and the calendar both
         * did: once the backfill finished this said 'done' for ever, including
         * while a queued SyncMailbox run was actually walking the folders.
         * An incremental pass has no total (the provider's change feed is a
         * stream, not a set), so the card runs indeterminate.
         */
        if ($account->mail_status === 'syncing') {
            return ['state' => 'syncing', 'synced' => $synced, 'mode' => 'incremental'];
        }

        return ['state' => 'done', 'synced' => $synced];
    }

    private function calendar($user): array
    {
        $account = $user->connectedAccounts()
            ->whereIn('provider', ['google', 'microsoft'])
            ->where('sync_calendar', true)
            ->whereNotNull('token')
            ->first();

        if (! $account) {
            return ['state' => 'off'];
        }

        $calendars = Calendar::where('owner_id', $user->id)
            ->whereNotNull('connected_account_id')
            ->get(['id', 'subscription_status', 'subscription_synced_at', 'updated_at']);

        if ($calendars->isEmpty()) {
            if (! $account->canReadCalendar()) {
                return ['state' => 'error', 'count' => 0];
            }

            // The post-connect import is still discovering calendars — but only
            // a recent connect counts. If discovery never runs (no worker), this
            // state used to pin a "Finding your calendars…" toast for ever.
            return $account->updated_at
                && $account->updated_at->gt(now()->subMinutes(Calendar::SYNC_STALE_MINUTES))
                ? ['state' => 'syncing', 'count' => 0]
                : ['state' => 'off'];
        }

        // effectiveSubscriptionStatus() settles abandoned runs — a stale
        // 'syncing' row must not pin the toast (same trap as OneDrive below).
        $statuses = $calendars->map(fn (Calendar $c) => $c->effectiveSubscriptionStatus());
        $syncing = $statuses->filter(fn ($s) => $s === 'syncing')->count();
        $errors = $statuses->filter(fn ($s) => $s === 'error')->count();

        if ($syncing > 0) {
            return [
                'state' => 'syncing',
                'count' => $calendars->count(),
                'synced' => $calendars->count() - $syncing,
                'pending' => $syncing,
            ];
        }

        return [
            'state' => $errors === $calendars->count() ? 'error' : 'done',
            'count' => $calendars->count(),
        ];
    }

    /**
     * Is the first full walk of this drive still underway?
     *
     * `last_success_at` is the authoritative stamp, but a worker killed after
     * Graph returned a deltaLink can leave that null while the cursor already
     * points at `token=…` (done) rather than `$skiptoken=…` (mid-walk resume).
     */
    private static function initialImportPending(SharePointConnection $connection): bool
    {
        if ($connection->last_success_at !== null) {
            return false;
        }

        $cursor = (string) $connection->delta_link;
        if ($cursor === '') {
            return true;
        }

        return str_contains($cursor, '$skiptoken=') || str_contains($cursor, '%24skiptoken=');
    }

    private function onedrive($user): array
    {
        $account = $user->connectedAccount('microsoft');

        if (! $account || ! $account->sync_onedrive || ! $account->token) {
            return ['state' => 'off'];
        }

        $connection = SharePointConnection::where('drive_kind', 'onedrive')
            ->where(function ($q) use ($user, $account) {
                $q->where('created_by', $user->id);
                if ($account->email) {
                    $q->orWhere('owner_upn', $account->email);
                }
            })
            ->orderBy('id')
            ->first();

        if (! $connection) {
            // Provisioning is queued but has not created the link yet.
            return ['state' => 'syncing', 'synced' => 0];
        }

        $synced = $connection->items()->count();

        // Same arithmetic as the Files sync panel: Graph's childCount summed
        // over every discovered folder plus the root — exact once discovery
        // finishes, a rising lower bound before that, null while unknown.
        $total = ($connection->items()
            ->where('item_type', 'folder')
            ->sum('child_count') + (int) $connection->root_child_count) ?: null;

        if ($connection->status === SharePointConnection::STATUS_ERROR) {
            return ['state' => 'error', 'synced' => $synced];
        }

        /*
         * `syncing` is a lock, not a fact. A run that is killed mid-pass (worker
         * restart, deploy, no worker at all) never reaches its final update and
         * leaves the flag set for ever — which pinned a "Syncing OneDrive…"
         * toast on screen all night with 1,103 of 1,103 items already imported.
         * The synchroniser already treats a lock older than LOCK_MINUTES as
         * abandoned; the status has to read it the same way or the UI keeps
         * reporting a run that no longer exists.
         */
        $running = $connection->status === SharePointConnection::STATUS_SYNCING
            && $connection->last_synced_at
            && $connection->last_synced_at->gt(now()->subMinutes(Synchroniser::LOCK_MINUTES));

        // Initial walk still in progress, or a run actively holding the lock.
        if ($running || self::initialImportPending($connection)) {
            return ['state' => 'syncing', 'synced' => $synced, 'total' => $total];
        }

        return ['state' => 'done', 'synced' => $synced];
    }

    /**
     * Smartsheet → client File Library document import (CBI).
     *
     * Administrators only, and only while FEATURE_CBI is on — everyone else
     * gets `off` so the toast never appears for an empty answer.
     */
    private function smartsheet($user): array
    {
        if (! config('services.smartsheet.cbi_enabled') || ! Role::isAdmin($user)) {
            return ['state' => 'off'];
        }

        $actor = SyncActor::resolve($user);
        if (! $actor) {
            return ['state' => 'off'];
        }

        $survey = (new DocumentImporter($actor))->survey();
        $pending = max(0, $survey['files'] - $survey['orphaned']);
        $done = $survey['done'];
        $total = $pending + $done;

        if ($pending < 1) {
            return $done > 0
                ? ['state' => 'done', 'synced' => $done, 'total' => $total]
                : ['state' => 'off'];
        }

        // Still copying. Prefer recent activity so a crashed run does not pin
        // an Importing toast forever; CBI can still force the card via watch().
        $recent = SmartsheetAttachment::query()
            ->whereNotNull('file_id')
            ->where('updated_at', '>', now()->subMinutes(30))
            ->exists();

        return [
            'state' => ($recent || $done === 0) ? 'syncing' : 'done',
            'synced' => $done,
            'total' => $total,
            'pending' => $pending,
            'clients' => $survey['clients'],
            'paused' => ! $recent && $done > 0,
        ];
    }
}
