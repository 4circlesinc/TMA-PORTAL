<?php

namespace App\Support\Reports;

use App\Models\Report;
use Throwable;

/**
 * Compute a report and store the answer on the row.
 *
 * One code path for both callers — the Reporting page creating or re-running a
 * report, and the `reports:run` scheduler tick — so a recurring report and a
 * hand-run one can never disagree about what the numbers mean.
 */
final class ReportRunner
{
    public static function run(Report $report): Report
    {
        /*
         * A builder that throws must not lose the report. The row keeps the
         * request and carries the reason, so the page can offer "Run again"
         * rather than the dialog appearing to do nothing — and a recurring
         * report that failed once still has a next run scheduled.
         */
        try {
            $report->forceFill([
                'data' => ReportBuilder::build($report),
                'status' => Report::STATUS_READY,
                'error' => null,
                'generated_at' => now(),
                'next_run_at' => $report->scheduleAfter(now()),
            ])->save();
        } catch (Throwable $e) {
            $report->forceFill([
                'status' => Report::STATUS_FAILED,
                'error' => mb_substr($e->getMessage(), 0, 2000),
                'generated_at' => now(),
                'next_run_at' => $report->scheduleAfter(now()),
            ])->save();
        }

        return $report;
    }

    /**
     * Roll a recurring report's window forward so it ends today.
     *
     * A one-off keeps the dates it was created with — re-running it is a
     * retry, not a new question — and so does a custom window, which is a
     * period somebody deliberately picked.
     */
    public static function rollWindow(Report $report): Report
    {
        if (! $report->isRecurring() || $report->range_key === 'custom') {
            return $report;
        }

        $days = Report::RANGES[$report->range_key];

        $report->ends_on = now()->toDateString();
        $report->starts_on = now()->copy()->subDays($days - 1)->toDateString();

        return $report;
    }
}
