<?php

namespace App\Http\Controllers;

use App\Models\EmailDelivery;
use App\Support\Access\Role;
use App\Support\UserTime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Settings → Account and Reporting → Notification History.
 *
 * "Below is a history of all email messages that have been sent from the
 * portal", which it was not: the page filtered a localStorage array that only
 * ever held whatever the mock UI had pushed into it. Every transactional email
 * really does leave a row behind (`email_deliveries`, written by
 * {@see App\Support\Mail\Deliveries}), so this reads that.
 *
 * Status is on the record on purpose. The portal's characteristic email
 * failure is a queued mail that never left, and a history that showed every
 * row as "sent" would hide exactly the thing an administrator opens this page
 * to find.
 */
class NotificationHistoryController extends Controller
{
    private const PER_PAGE = 100;

    /** Recipients offered in the filter. Long enough to be useful, short enough to load. */
    private const RECIPIENT_LIMIT = 200;

    public function index(Request $request): JsonResponse
    {
        abort_unless(Role::can($request->user(), 'settings.reporting'), 403);

        $filters = $request->validate([
            'date' => ['nullable', 'date'],
            'recipient' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'string', 'max:16'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $user = $request->user();
        $query = EmailDelivery::query()->orderByDesc('created_at');

        if (! empty($filters['recipient'])) {
            $query->where('recipient', $filters['recipient']);
        }

        if (! empty($filters['status'])) {
            $filters['status'] === 'failed'
                ? $query->whereIn('status', EmailDelivery::FAILURE_STATUSES)
                : $query->where('status', $filters['status']);
        }

        /*
         * The picker hands over a plain calendar date, which is a day in the
         * reader's zone, not a UTC day. Converting the boundaries rather than
         * comparing date strings is what stops an email sent at 8pm local from
         * disappearing off the day it was actually sent on.
         */
        if (! empty($filters['date'])) {
            $zone = UserTime::zone($user);
            $day = Carbon::parse($filters['date'], $zone);
            $query->whereBetween('created_at', [
                $day->copy()->startOfDay()->utc(),
                $day->copy()->endOfDay()->utc(),
            ]);
        }

        $page = $query->paginate(self::PER_PAGE, ['*'], 'page', $filters['page'] ?? 1);

        return response()->json([
            'notifications' => collect($page->items())->map(fn (EmailDelivery $d) => [
                'id' => $d->uuid,
                'recipient' => $d->recipient,
                'subject' => $d->subject ?: '(no subject)',
                'template' => $this->templateLabel($d->template),
                'status' => $d->status,
                'failed' => $d->hasFailed(),
                'error' => $d->error,
                'sentAt' => ($d->sent_at ?: $d->created_at)?->toIso8601String(),
                'date' => UserTime::format($d->sent_at ?: $d->created_at, $user, 'j M Y'),
                'time' => UserTime::format($d->sent_at ?: $d->created_at, $user, 'j M Y, H:i'),
            ])->values(),
            'page' => $page->currentPage(),
            'pages' => $page->lastPage(),
            'total' => $page->total(),
            'recipients' => EmailDelivery::query()
                ->select('recipient')
                ->distinct()
                ->orderBy('recipient')
                ->limit(self::RECIPIENT_LIMIT)
                ->pluck('recipient'),
            'summary' => [
                'total' => EmailDelivery::count(),
                'queued' => EmailDelivery::where('status', EmailDelivery::STATUS_QUEUED)->count(),
                'failed' => EmailDelivery::whereIn('status', EmailDelivery::FAILURE_STATUSES)->count(),
            ],
        ]);
    }

    /**
     * "clientInvite" => "Client invite". The template column stores the
     * Postcards helper that built the mail, which is a readable name already —
     * it just isn't written for a table cell.
     */
    private function templateLabel(?string $template): ?string
    {
        if (! $template) {
            return null;
        }

        return ucfirst(mb_strtolower(trim(preg_replace('/(?<!^)[A-Z]/', ' $0', $template))));
    }
}
