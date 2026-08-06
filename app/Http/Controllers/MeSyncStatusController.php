<?php

namespace App\Http\Controllers;

use App\Models\Calendar;
use App\Models\MailMessage;
use App\Models\SharePointConnection;
use App\Support\Mail\Mailbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * One aggregate answer to "is my stuff syncing?" — email, calendar and
 * OneDrive in a single poll. Drives the bottom-right sync toasts that appear
 * right after connecting. Each state is derived from the same records the
 * feature pages read, so the toasts never disagree with the pages; the
 * heavier per-page status endpoints (stall diagnosis, per-folder counts)
 * stay where they are.
 *
 * States per service: off | syncing | done | error.
 */
class MeSyncStatusController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'email' => $this->email($user),
            'calendar' => $this->calendar($user),
            'onedrive' => $this->onedrive($user),
        ]);
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

        if ($account->mail_backfilled_at !== null) {
            return ['state' => 'done', 'synced' => $synced];
        }

        if ($account->mail_status === 'error') {
            return ['state' => 'error', 'synced' => $synced];
        }

        return ['state' => 'syncing', 'synced' => $synced, 'total' => $total];
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
            ->get(['id', 'subscription_status']);

        if ($calendars->isEmpty()) {
            // The post-connect import is still discovering calendars.
            return $account->canReadCalendar()
                ? ['state' => 'syncing', 'count' => 0]
                : ['state' => 'error', 'count' => 0];
        }

        $syncing = $calendars->where('subscription_status', 'syncing')->count();
        $errors = $calendars->where('subscription_status', 'error')->count();

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

        // No delta cursor yet = the initial walk has not finished.
        if ($connection->delta_link === null || $connection->status === SharePointConnection::STATUS_SYNCING) {
            return ['state' => 'syncing', 'synced' => $synced, 'total' => $total];
        }

        return ['state' => 'done', 'synced' => $synced];
    }
}
