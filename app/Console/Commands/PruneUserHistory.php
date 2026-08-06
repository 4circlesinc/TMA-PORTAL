<?php

namespace App\Console\Commands;

use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Honour each person's History retention choice (Settings → Privacy).
 *
 * The setting used to be stored and never acted on, which is the worst shape
 * for a privacy control: it reads as a promise that the trail is cleared.
 * This deletes what it says it deletes, per account:
 *
 *  - their activity trail (activity_logs rows they are the actor of), and
 *  - their READ notifications.
 *
 * Unread notifications are never dropped, however old — a retention window is
 * about not keeping a record forever, not about hiding something the person
 * has not seen yet. Records that belong to the firm rather than the person
 * (files, messages, audit-grade auth events) are out of scope: one user's
 * preference must not erase the firm's books.
 */
class PruneUserHistory extends Command
{
    protected $signature = 'portal:prune-history {--dry-run : Report what would be deleted, delete nothing}';

    protected $description = 'Delete activity and read notifications past each user\'s retention window';

    /** What the Privacy picker offers. Anything else falls back to 30. */
    private const ALLOWED = [7, 14, 30, 60, 90, 365];

    private const DEFAULT_DAYS = 30;

    public function handle(): int
    {
        $dry = (bool) $this->option('dry-run');
        $activity = 0;
        $notifications = 0;

        User::query()->select(['id', 'preferences'])->chunkById(200, function ($users) use (&$activity, &$notifications, $dry) {
            foreach ($users as $user) {
                $days = (int) data_get($user->preferences, 'historyDays', self::DEFAULT_DAYS);
                if (! in_array($days, self::ALLOWED, true)) {
                    $days = self::DEFAULT_DAYS;
                }

                $cutoff = now()->subDays($days);

                $activityQuery = ActivityLog::query()
                    ->where('actor_id', $user->id)
                    ->where('created_at', '<', $cutoff);

                $notificationQuery = Notification::query()
                    ->where('user_id', $user->id)
                    ->whereNotNull('read_at')
                    ->where('created_at', '<', $cutoff);

                if ($dry) {
                    $activity += $activityQuery->count();
                    $notifications += $notificationQuery->count();

                    continue;
                }

                $activity += $activityQuery->delete();
                $notifications += $notificationQuery->delete();
            }
        });

        $this->info(($dry ? 'Would delete ' : 'Deleted ')
            .$activity.' activity row(s) and '.$notifications.' read notification(s).');

        return self::SUCCESS;
    }
}
