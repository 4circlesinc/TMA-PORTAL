<?php

namespace App\Jobs;

use App\Models\CipProvider;
use App\Models\Folder;
use App\Support\Cip\LibraryMigration;
use App\Support\Cip\PortalLibrary;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Move one applicant folder into the TMA CIP Applications Portal.
 *
 * One folder per job so a Cloud command is not asked to upload every
 * application in a single process. A folder already on the site returns
 * immediately. Files already uploaded are not sent again, so a job killed
 * by its timeout is finished by the next attempt.
 */
class MigrateCipApplicantFolder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    public array $backoff = [60, 180, 600, 900];

    /**
     * A single applicant can be a hundred files. The queue's retry_after
     * (1830s) sits above this, so a slow folder is not handed to a second
     * worker while the first is still uploading it.
     */
    public int $timeout = 1700;

    public function __construct(public int $folderId, public int $providerId) {}

    public function handle(): void
    {
        $folder = Folder::find($this->folderId);
        $provider = CipProvider::find($this->providerId);
        $target = PortalLibrary::connection();
        if (! $folder || ! $provider || ! $target) {
            return;
        }

        $survey = LibraryMigration::survey($folder, $target);
        if ($survey['inPlace'] && $survey['waiting'] === 0 && $survey['onSite'] === $survey['files']) {
            return;
        }

        $lock = Cache::lock('cip-library-migrate-'.$folder->id, $this->timeout + 120);
        if (! $lock->get()) {
            self::dispatch($this->folderId, $this->providerId)->delay(now()->addMinutes(2));

            return;
        }

        try {
            $result = LibraryMigration::migrate($folder, $provider, $target);
        } finally {
            $lock->release();
        }

        Log::info('CIP library folder', [
            'folder' => $folder->id,
            'provider' => $provider->id,
            'status' => $result['status'],
            'pushed' => $result['pushed'] ?? 0,
            'missing' => $result['missing'] ?? 0,
        ]);

        if ($result['status'] === 'done') {
            return;
        }

        $detail = $result['reason'] ?? (($result['missing'] ?? 0).' file(s) still missing');

        throw new RuntimeException($folder->name.': '.$detail);
    }
}
