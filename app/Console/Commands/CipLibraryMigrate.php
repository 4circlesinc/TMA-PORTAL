<?php

namespace App\Console\Commands;

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
 * Rerunnable: anything a run could not finish is picked up by the next one.
 */
class CipLibraryMigrate extends Command
{
    protected $signature = 'cip:library:migrate
        {--apply : Actually move and push. Without it, nothing changes.}
        {--provider= : Only this provider code (e.g. GAL)}
        {--limit=0 : Stop after this many applicant folders (0 = all)}';

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
        if ($limit > 0) {
            $candidates = $candidates->take($limit);
        }

        return $this->option('apply')
            ? $this->apply($candidates, $target, $only)
            : $this->dryRun($candidates, $target);
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

    private function apply($candidates, $target, ?CipProvider $only): int
    {
        // Every provider gets its folder up front, so new applications file
        // in the new place from now on, even firms with nothing to move.
        CipProvider::query()
            ->when($only, fn ($q) => $q->whereKey($only->id))
            ->orderBy('id')
            ->each(fn (CipProvider $provider) => Pusher::suspend(fn () => PortalLibrary::providerFolder($provider)));

        $done = 0;
        $problems = 0;

        foreach ($candidates as ['folder' => $folder, 'provider' => $provider]) {
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
        if ($problems === 0) {
            $this->line('When you are happy with the site, resume its sync in Settings → Background Operations.');
        } else {
            $this->line('Run the same command again to retry; finished folders are skipped.');
        }

        return $problems === 0 ? self::SUCCESS : self::FAILURE;
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
