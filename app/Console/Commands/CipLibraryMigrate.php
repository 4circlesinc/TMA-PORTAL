<?php

namespace App\Console\Commands;

use App\Jobs\MigrateCipApplicantFolder;
use App\Models\CipProvider;
use App\Support\Cip\LibraryMigration;
use App\Support\Cip\PortalLibrary;
use App\Support\SharePoint\Pusher;
use Illuminate\Console\Command;

/**
 * Move the portal's applications into the TMA CIP Applications Portal.
 *
 * Step two of two (after cip:library:connect). Without --apply it only
 * reports what would move and changes nothing. With --apply each applicant
 * folder the portal created is moved under its provider's folder and pushed
 * to the site; the copy already in Microsoft is kept, frozen, as an archive.
 * Historical folders the old libraries imported are never moved.
 *
 * With a real queue, --apply hands each unfinished folder to its own job and
 * returns. One process is never asked to upload every application. Anything
 * a job could not finish is picked up by running this again.
 */
class CipLibraryMigrate extends Command
{
    protected $signature = 'cip:library:migrate
        {--apply : Actually move and push. Without it, nothing changes.}
        {--provider= : Only this provider code (e.g. GAL)}
        {--limit=0 : Only this many unfinished folders (0 = all)}';

    protected $description = 'Move portal applications into the TMA CIP Applications Portal and its SharePoint site';

    public function handle(): int
    {
        $target = PortalLibrary::connection();
        if (! $target) {
            $this->error('Not connected yet. Run: php artisan cip:library:connect');

            return self::FAILURE;
        }

        $only = null;
        if ($this->option('provider')) {
            $only = CipProvider::where('code', strtoupper((string) $this->option('provider')))->first();
            if (! $only) {
                $this->error('No provider with code '.$this->option('provider').'.');

                return self::FAILURE;
            }
        }

        $candidates = LibraryMigration::candidates($only);
        $limit = max(0, (int) $this->option('limit'));

        if (! $this->option('apply')) {
            if ($limit > 0) {
                $candidates = $candidates->take($limit);
            }

            return $this->dryRun($candidates, $target);
        }

        return config('queue.default') === 'sync'
            ? $this->applyInline($candidates, $target, $only, $limit)
            : $this->queueRemaining($candidates, $target, $only, $limit);
    }

    private function dryRun($candidates, $target): int
    {
        $this->line('<options=bold>Dry run. Nothing will change.</>');
        $this->line('Target: '.PortalLibrary::folderName().' → '.($target->site_url ?: $target->site_name).' / '.$target->drive_name);
        $this->line('');

        $rows = [];
        $totals = ['folders' => 0, 'files' => 0, 'waiting' => 0, 'bytes' => 0];

        foreach ($candidates as ['folder' => $folder, 'provider' => $provider]) {
            $survey = LibraryMigration::survey($folder, $target);
            $state = match (true) {
                $survey['inPlace'] && $survey['onSite'] === $survey['files'] => 'done',
                $survey['inPlace'] => 'moved, '.($survey['files'] - $survey['onSite']).' file(s) to push',
                default => 'to move',
            };
            $rows[] = [$provider->name, $folder->name, $survey['files'], $survey['waiting'], $this->size($survey['bytes']), $state];

            $totals['folders']++;
            $totals['files'] += $survey['files'];
            $totals['waiting'] += $survey['waiting'];
            $totals['bytes'] += $survey['bytes'];
        }

        if ($rows === []) {
            $this->info('No portal applications to move.');

            return self::SUCCESS;
        }

        $this->table(['Provider', 'Applicant folder', 'Files', 'Only in Microsoft', 'Size', 'State'], $rows);
        $this->line(sprintf(
            '%d applicant folder(s), %d file(s), %s. %d file(s) will be fetched from Microsoft first.',
            $totals['folders'], $totals['files'], $this->size($totals['bytes']), $totals['waiting'],
        ));
        $this->line('Historical folders imported from the old libraries are not listed and will not move.');
        $this->line('');
        $this->line('Run again with --apply to move them.');

        return self::SUCCESS;
    }

    /**
     * Hand each unfinished folder to the queue and return.
     *
     * The console that runs this is killed once the upload runs long. A
     * worker finishes one folder, then the next, and a folder already on
     * the site is not queued again.
     */
    private function queueRemaining($candidates, $target, ?CipProvider $only, int $limit): int
    {
        $this->ensureProviderFolders($only);

        $queued = 0;
        $done = 0;

        foreach ($candidates as ['folder' => $folder, 'provider' => $provider]) {
            if ($this->finished($folder, $target)) {
                $done++;

                continue;
            }

            if ($limit > 0 && $queued >= $limit) {
                break;
            }

            MigrateCipApplicantFolder::dispatch($folder->id, $provider->id);
            $queued++;
        }

        if ($queued === 0) {
            $this->info('Nothing left to move.');
            $this->line('When you are happy with the site, resume its sync in Settings → Background Operations.');

            return self::SUCCESS;
        }

        $this->info($queued.' applicant folder(s) queued. '.$done.' already on the site.');
        $this->line('Each folder is its own job. Run this again later to queue any that did not finish.');
        $this->line('Leave inbound sync paused until a run says nothing is left.');

        return self::SUCCESS;
    }

    private function applyInline($candidates, $target, ?CipProvider $only, int $limit): int
    {
        $this->ensureProviderFolders($only);

        $done = 0;
        $problems = 0;
        $attempted = 0;
        $stopped = false;

        foreach ($candidates as ['folder' => $folder, 'provider' => $provider]) {
            if ($this->finished($folder, $target)) {
                continue;
            }

            if ($limit > 0 && $attempted >= $limit) {
                $stopped = true;

                break;
            }

            $attempted++;
            $label = $provider->name.' / '.$folder->name;
            $result = LibraryMigration::migrate($folder, $provider, $target);

            if ($result['status'] === 'done') {
                $done++;
                $this->line('  ✓ '.$label.($result['renamed'] ?? null ? ' (renamed "'.$result['renamed'].'", the name was taken)' : '')
                    .($result['pushed'] ? ' — '.$result['pushed'].' file(s) uploaded' : ''));

                continue;
            }

            $problems++;
            if ($result['status'] === 'skipped') {
                $this->warn('  - '.$label.': skipped, '.$result['reason']);

                continue;
            }

            $this->warn('  ! '.$label.': '.$result['missing'].' file(s) not on the site yet');
            foreach (array_slice($result['failed'], 0, 5) as $failure) {
                $this->line('      '.$failure);
            }
        }

        $this->line('');
        $this->info($done.' applicant folder(s) complete, '.$problems.' need another run.');
        if ($problems === 0 && ! $stopped) {
            $this->line('When you are happy with the site, resume its sync in Settings → Background Operations.');
        } else {
            $this->line('Run the same command again to retry; finished folders are skipped.');
        }

        return $problems === 0 ? self::SUCCESS : self::FAILURE;
    }

    /** Every provider gets its folder up front, so new applications file in the new place. */
    private function ensureProviderFolders(?CipProvider $only): void
    {
        CipProvider::query()
            ->when($only, fn ($q) => $q->whereKey($only->id))
            ->orderBy('id')
            ->each(fn (CipProvider $provider) => Pusher::suspend(fn () => PortalLibrary::providerFolder($provider)));
    }

    private function finished($folder, $target): bool
    {
        $survey = LibraryMigration::survey($folder, $target);

        return $survey['inPlace'] && $survey['waiting'] === 0 && $survey['onSite'] === $survey['files'];
    }

    private function size(int $bytes): string
    {
        return match (true) {
            $bytes >= 1024 ** 3 => round($bytes / 1024 ** 3, 1).' GB',
            $bytes >= 1024 ** 2 => round($bytes / 1024 ** 2, 1).' MB',
            $bytes >= 1024 => round($bytes / 1024).' KB',
            default => $bytes.' B',
        };
    }
}
