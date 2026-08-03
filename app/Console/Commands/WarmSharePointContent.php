<?php

namespace App\Console\Commands;

use App\Models\FileItem;
use App\Support\SharePoint\RemoteContent;
use Illuminate\Console\Command;

/**
 * Pull down the bytes of files that were imported by reference.
 *
 * The import deliberately records structure without content so a library is
 * browsable in minutes rather than hours. Anything nobody has opened yet still
 * lives only in SharePoint; this fetches it in the background.
 *
 * Nothing depends on this having run — an un-warmed file materialises itself
 * the moment someone opens it. It just means the first person to open a file is
 * less likely to be the one who waits for it.
 *
 * Shard to run several at once, which is the only way to use the bandwidth:
 *
 *   for i in 0 1 2 3; do php artisan sharepoint:warm-content --shard=$i --of=4 & done
 */
class WarmSharePointContent extends Command
{
    protected $signature = 'sharepoint:warm-content
        {--limit=0 : Stop after this many files (0 = no limit)}
        {--shard=0 : This worker\'s index, for running several at once}
        {--of=1 : How many workers are running in total}';

    protected $description = 'Fetch content for SharePoint files imported by reference';

    public function handle(): int
    {
        $shard = max(0, (int) $this->option('shard'));
        $of = max(1, (int) $this->option('of'));
        $limit = max(0, (int) $this->option('limit'));

        $query = FileItem::where('content_state', RemoteContent::PENDING)
            // Deterministic split so two workers never pick the same file.
            // The per-file lock would catch it, but only after both have
            // already downloaded the bytes.
            ->when($of > 1, fn ($q) => $q->whereRaw('MOD(id, ?) = ?', [$of, $shard]))
            ->orderBy('id');

        $total = (clone $query)->count();

        if ($total === 0) {
            $this->info('Nothing pending.');

            return self::SUCCESS;
        }

        $target = $limit > 0 ? min($limit, $total) : $total;
        $this->line("Warming {$target} of {$total} pending files (shard {$shard}/{$of})");

        $bar = $this->output->createProgressBar($target);
        $bar->start();

        $done = 0;
        $failed = 0;
        $bytes = 0;

        // chunkById, not chunk: every file processed leaves the result set
        // (content_state stops being 'pending'), which shifts an OFFSET-based
        // pager and would silently skip half of them.
        $query->chunkById(50, function ($files) use (&$done, &$failed, &$bytes, $bar, $target) {
            foreach ($files as $file) {
                if ($target > 0 && $done + $failed >= $target) {
                    return false;
                }

                if (RemoteContent::ensure($file)) {
                    $done++;
                    $bytes += (int) $file->fresh()->size;
                } else {
                    $failed++;
                }

                $bar->advance();
            }

            return true;
        });

        $bar->finish();
        $this->newLine();
        $this->line(sprintf(
            '  %d fetched (%.1f MB)%s',
            $done,
            $bytes / 1024 / 1024,
            $failed ? ", {$failed} could not be fetched" : ''
        ));

        return self::SUCCESS;
    }
}
