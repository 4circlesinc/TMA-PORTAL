<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Support\Realtime\Live;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Delayed applications (§20) — 180 days after Accepted for processing, with
 * no decision, the file becomes Delayed.
 *
 * The clock starts when staff record the accepted date (§19). Nothing here
 * writes `accepted_at`; it only measures from it. The flip is a scheduled
 * job, not a picker: {@see Engine} already allows BACKGROUND CHECK → DELAYED
 * with a null actor (the system), and this is the caller that uses it.
 *
 * Idempotent on purpose. An already-delayed file is not in the due set, so a
 * second daily tick never re-notifies. Engine tells §22's four classes.
 */
class Delay
{
    /** Days after acceptance with no decision before the file is delayed. */
    public const DAYS = 180;

    /**
     * Flag every file whose delay clock has run out.
     *
     * Returns the number that moved, so the command can say what it did.
     * Live is flushed here because a console tick has no HTTP terminate step
     * of its own — colleagues with the table open still see the move.
     */
    public static function run(): int
    {
        if (! CipAccess::enabled()) {
            return 0;
        }

        $flagged = 0;

        self::due()->each(function (CipApplication $application) use (&$flagged) {
            if (self::flag($application) !== null) {
                $flagged++;
            }
        });

        Live::flush();

        return $flagged;
    }

    /**
     * Files in Background check whose accepted date is 180 or more days ago,
     * with no decision recorded.
     *
     * Status is the first filter: GRANTED and DENIED are already terminal, and
     * DELAYED is the destination. `decision` / `decided_at` are the belt —
     * a row that somehow still sits in Background check after a decision must
     * not be flagged as delayed.
     *
     * @return Builder<CipApplication>
     */
    public static function due(): Builder
    {
        $cutoff = now()->subDays(self::DAYS)->toDateString();

        return CipApplication::query()
            ->where('status', Status::BACKGROUND_CHECK)
            ->whereNotNull('accepted_at')
            ->whereDate('accepted_at', '<=', $cutoff)
            ->whereNull('decision')
            ->whereNull('decided_at');
    }

    /**
     * Move one file to Delayed and tell the three named classes.
     *
     * Returns the refreshed application, or null when it was not due — already
     * delayed, already decided, or not on an edge the engine will walk.
     */
    public static function flag(CipApplication $application): ?CipApplication
    {
        $application->refresh();

        if ($application->status === Status::DELAYED) {
            return null;
        }

        if ($application->decision !== null || $application->decided_at !== null) {
            return null;
        }

        if (! Engine::canTransition($application, Status::DELAYED)) {
            return null;
        }

        $acceptedAt = $application->accepted_at?->toDateString();
        $days = $application->accepted_at
            ? (int) $application->accepted_at->copy()->startOfDay()->diffInDays(now()->startOfDay())
            : self::DAYS;

        $application = DB::transaction(function () use ($application, $acceptedAt, $days) {
            $meta = [
                'acceptedAt' => $acceptedAt,
                'days' => $days,
            ];

            Engine::apply($application, Status::DELAYED, null, $meta);
            Engine::record($application, CipEvent::ACTION_DELAYED, null, $meta);

            return $application->refresh();
        });

        Live::staff(Live::CIP);

        return $application;
    }

    /**
     * The named classes, merged and unique by mailbox.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function recipients(CipApplication $application): array
    {
        return Contacts::parties($application);
    }
}
