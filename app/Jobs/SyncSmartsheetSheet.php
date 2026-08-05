<?php

namespace App\Jobs;

use App\Models\SmartsheetSheet;
use App\Support\Cbi\Mapper;
use App\Support\Smartsheet\Synchroniser;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Str;

/**
 * Mirror one Smartsheet sheet, then map its rows into the CBI domain.
 * Dispatched per sheet by smartsheet:sync so a big master tracker can't
 * hold the rest of the workspace hostage.
 */
class SyncSmartsheetSheet implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    // Master trackers carry ~2,000 rows plus 1,000+ discussions; give the
    // pass room. uniqueFor and expireAfter sit above timeout so a dead
    // worker can never lock a sheet forever (the photo-job starvation
    // lesson).
    public int $timeout = 540;

    public int $uniqueFor = 600;

    public function __construct(
        public SmartsheetSheet $sheet,
        public bool $force = false,
    ) {}

    public function uniqueId(): string
    {
        return (string) $this->sheet->id;
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping('smartsheet:'.$this->sheet->id))->dontRelease()->expireAfter(600)];
    }

    public function handle(): void
    {
        if (! config('services.smartsheet.cbi_enabled')) {
            return;
        }

        $result = Synchroniser::syncSheet($this->sheet, (string) Str::uuid(), $this->force);

        if ($result['status'] === 'throttled') {
            // Re-dispatch with the provider's own delay instead of burning a
            // retry while a worker sleeps (SharePoint's throttle pattern).
            self::dispatch($this->sheet, $this->force)->delay($result['retryAfter'] ?? 30);

            return;
        }

        if ($result['status'] === 'synced') {
            Mapper::mapSheet($this->sheet->fresh());
        }
    }

    public function failed(\Throwable $e): void
    {
        $this->sheet->update([
            'status' => SmartsheetSheet::STATUS_ERROR,
            'last_error' => Str::limit($e->getMessage(), 500),
        ]);
    }
}
