<?php

namespace App\Console\Commands;

use App\Models\CallRecording;
use App\Support\Files\Vault;
use App\Support\SecurityPolicies;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Drop call recordings whose retain_until has passed, unless legal hold is on.
 */
class PruneCallRecordings extends Command
{
    protected $signature = 'recordings:prune';

    protected $description = 'Delete call recordings past retention that are not on legal hold';

    public function handle(): int
    {
        $days = SecurityPolicies::callRecordingRetentionDays();
        $cutoff = now()->subDays($days);

        $removed = 0;
        CallRecording::query()
            ->where('legal_hold', false)
            ->where('status', CallRecording::STATUS_READY)
            ->where(function ($q) use ($cutoff) {
                $q->where(function ($w) {
                    $w->whereNotNull('retain_until')->where('retain_until', '<=', now());
                })->orWhere(function ($w) use ($cutoff) {
                    $w->whereNull('retain_until')->where('ended_at', '<=', $cutoff);
                });
            })
            ->orderBy('id')
            ->each(function (CallRecording $recording) use (&$removed) {
                if ($recording->path) {
                    try {
                        Storage::disk($recording->disk ?: Vault::diskName())->delete($recording->path);
                    } catch (\Throwable) {
                    }
                }
                $recording->delete();
                $removed++;
            });

        $this->info("Removed {$removed} expired recording(s).");

        return self::SUCCESS;
    }
}
