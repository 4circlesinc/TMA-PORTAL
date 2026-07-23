<?php

namespace App\Jobs;

use App\Models\Calendar;
use App\Support\Calendar\IcsException;
use App\Support\Calendar\IcsImporter;
use App\Support\Calendar\IcsReader;
use App\Support\Calendar\SubscriptionUrl;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

/**
 * Re-fetches a subscribed ICS URL and folds the changes in.
 *
 * Backgrounded because a slow or dead remote server must never hold up the
 * Calendar page. A failure is recorded on the calendar and shown against that
 * one row in the sidebar; it never blocks the rest of the calendar, which is
 * what section 24 of the brief asks for.
 */
class RefreshIcsSubscription implements ShouldQueue
{
    use Queueable;

    /** Give up on a remote server rather than tying up a worker. */
    private const TIMEOUT_SECONDS = 20;

    private const MAX_FAILURES_BEFORE_DISABLE = 10;

    public int $tries = 2;

    public function __construct(public int $calendarId) {}

    public function handle(): void
    {
        $calendar = Calendar::find($this->calendarId);

        if (! $calendar
            || $calendar->source !== Calendar::SOURCE_ICS_SUBSCRIPTION
            || ! $calendar->subscription_url
            || $calendar->subscription_status === 'disabled') {
            return;
        }

        $calendar->forceFill([
            'subscription_status' => 'syncing',
            'subscription_attempted_at' => now(),
        ])->save();

        try {
            $url = SubscriptionUrl::validate($calendar->subscription_url);

            $request = Http::timeout(self::TIMEOUT_SECONDS)
                ->withHeaders(['Accept' => 'text/calendar, text/plain'])
                // Redirects are followed by the client, so each hop is
                // re-checked rather than trusted.
                ->withOptions(['allow_redirects' => ['max' => 3, 'strict' => true]]);

            // Conditional GET: an unchanged calendar costs a 304, not a
            // download and a full re-diff.
            if ($calendar->subscription_etag) {
                $request = $request->withHeaders(['If-None-Match' => $calendar->subscription_etag]);
            }

            $response = $request->get($url);

            if ($response->status() === 304) {
                $this->succeed($calendar, $calendar->subscription_etag);

                return;
            }

            if (! $response->successful()) {
                throw new IcsException('The calendar server returned '.$response->status().'.');
            }

            $parsed = IcsReader::parse($response->body());

            /*
             * A subscription mirrors the source, so duplicates are *updated*
             * rather than skipped — otherwise a changed meeting would never
             * change here. Attendees are not imported: a read-only feed's
             * guest list is not this portal's to manage, and writing it would
             * generate invitations nobody asked for.
             */
            IcsImporter::import(
                $calendar,
                $parsed['events'],
                $calendar->owner,
                IcsImporter::ON_DUPLICATE_UPDATE,
                null,
                withAttendees: false,
            );

            $this->succeed($calendar, $response->header('ETag') ?: null);
        } catch (\Throwable $e) {
            $this->fail($calendar, $e->getMessage());
        }
    }

    private function succeed(Calendar $calendar, ?string $etag): void
    {
        $calendar->forceFill([
            'subscription_status' => 'ok',
            'subscription_error' => null,
            'subscription_synced_at' => now(),
            'subscription_etag' => $etag,
            'subscription_failures' => 0,
        ])->save();
    }

    private function fail(Calendar $calendar, string $message): void
    {
        $failures = (int) $calendar->subscription_failures + 1;

        $calendar->forceFill([
            // A URL that has failed this many times in a row is not coming
            // back on its own; stop retrying it every hour and let the user
            // fix or remove it. The sidebar shows why.
            'subscription_status' => $failures >= self::MAX_FAILURES_BEFORE_DISABLE ? 'disabled' : 'error',
            'subscription_error' => mb_substr($message, 0, 500),
            'subscription_failures' => $failures,
        ])->save();
    }
}
