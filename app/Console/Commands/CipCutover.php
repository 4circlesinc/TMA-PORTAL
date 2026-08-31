<?php

namespace App\Console\Commands;

use App\Models\CbiApplication;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Cutover;
use Illuminate\Console\Command;

class CipCutover extends Command
{
    protected $signature = 'cip:cutover
                            {--dry-run : Report what would be migrated without writing anything}
                            {--include-needs-review : Also migrate rows the mirror flagged as ambiguous}
                            {--limit= : Stop after this many new CIP applications}
                            {--pause : Pause Smartsheet sync (after migrating, or on its own)}';

    protected $description = 'Migrate the CBI Smartsheet mirror into native CIP applications and optionally pause sync';

    public function handle(): int
    {
        if (! CipAccess::enabled()) {
            $this->error('CIP is disabled (FEATURE_CIP).');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $pause = (bool) $this->option('pause');
        $limit = $this->option('limit') !== null ? max(1, (int) $this->option('limit')) : null;

        $pending = CbiApplication::query()->count();
        $this->info(sprintf(
            'CBI mirror holds %s application%s.',
            number_format($pending),
            $pending === 1 ? '' : 's',
        ));

        if ($dryRun) {
            $this->warn('Dry run — nothing will be written.');
        }

        $cutover = new Cutover($dryRun, (bool) $this->option('include-needs-review'));

        if ($pending > 0) {
            $bar = $this->output->createProgressBar($limit ?? $pending);
            $bar->start();
            $cutover->run($limit, fn () => $bar->advance());
            $bar->finish();
            $this->newLine(2);
        }

        if ($pause && ! $dryRun) {
            $cutover->pauseSmartsheet();
            $this->info('Smartsheet sync is paused. Resume it in Settings → Background Operations if a catch-up is needed.');
        } elseif ($pause && $dryRun) {
            $this->warn('--pause is ignored during a dry run.');
        }

        $s = $cutover->stats;
        $this->table(['', 'Count'], [
            ['Migrated', number_format($s['migrated'])],
            ['Already on CIP', number_format($s['skippedAlready'])],
            ['Needs review (skipped)', number_format($s['skippedNeedsReview'])],
            ['No matching provider', number_format($s['skippedNoProvider'])],
            ['Duplicate number', number_format($s['skippedDuplicateNumber'])],
            ['Comments copied', number_format($s['comments'])],
            ['History rows copied', number_format($s['events'])],
            ['Smartsheet paused', $s['paused'] ? 'yes' : 'no'],
        ]);

        $this->line('Attachment bytes are a Cloud-server job (`cbi:import-documents`), not this command.');
        $this->line('After verification, keep Smartsheet paused and work from /citizenship-applications. /cbi bookmarks land there while FEATURE_CIP is on.');

        return self::SUCCESS;
    }
}
