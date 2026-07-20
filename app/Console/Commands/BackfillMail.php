<?php

namespace App\Console\Commands;

use App\Jobs\BackfillMailbox;
use App\Models\ConnectedAccount;
use Illuminate\Console\Command;

/**
 * Kick off (or resume) the history backfill for connected mailboxes. Safe to
 * re-run: progress is stored per folder and finished mailboxes are skipped.
 */
class BackfillMail extends Command
{
    protected $signature = 'mail:backfill {--account= : Only this connected account id} {--restart : Start over from the newest page}';

    protected $description = 'Pull the full message history for connected mailboxes onto the queue';

    public function handle(): int
    {
        $accounts = ConnectedAccount::where('sync_email', true)
            ->when($this->option('account'), fn ($q, $id) => $q->where('id', $id))
            ->get();

        if ($accounts->isEmpty()) {
            $this->warn('No mail-enabled connected accounts found.');

            return self::SUCCESS;
        }

        foreach ($accounts as $account) {
            if ($this->option('restart')) {
                $account->forceFill(['mail_backfill' => null, 'mail_backfilled_at' => null])->save();
            }

            if ($account->mail_backfilled_at && ! $this->option('restart')) {
                $this->line("  · {$account->email} — already backfilled, skipping");

                continue;
            }

            BackfillMailbox::dispatch($account);
            $this->line("  · {$account->email} — backfill queued");
        }

        $this->info('Queued. Make sure a worker is running: php artisan queue:work');

        return self::SUCCESS;
    }
}
