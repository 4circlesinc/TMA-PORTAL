<?php

namespace App\Jobs;

use App\Models\FileItem;
use App\Models\Share;
use App\Models\User;
use App\Support\Files\MalwareScanner;
use App\Support\Files\Vault;
use App\Support\Security\SecurityAlertPolicy;
use App\Support\Security\SecurityAudit;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class ScanUploadedFile implements ShouldQueue
{
    use Queueable;

    public function __construct(public int $fileId) {}

    public function handle(): void
    {
        $file = FileItem::query()->withTrashed()->find($this->fileId);
        if (! $file) {
            return;
        }

        $local = Vault::localCopy($file);
        if ($local === null) {
            $file->forceFill([
                'malware_status' => MalwareScanner::SKIPPED,
                'malware_scanned_at' => now(),
            ])->saveQuietly();

            return;
        }

        try {
            $status = MalwareScanner::scanPath($local);
        } finally {
            Vault::cleanupLocalCopy($local);
        }

        $file->forceFill([
            'malware_status' => $status,
            'malware_scanned_at' => now(),
        ])->saveQuietly();

        SecurityAudit::record('file.scanned', [
            'file_id' => $file->id,
            'uuid' => $file->uuid,
            'status' => $status,
        ]);

        if ($status !== MalwareScanner::INFECTED) {
            return;
        }

        Share::query()
            ->where('item_type', 'file')
            ->where('item_id', $file->id)
            ->where('kind', 'link')
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        $actor = User::query()->find($file->uploaded_by);
        if ($actor) {
            SecurityAlertPolicy::fanOut(
                'malwareDetected',
                $actor,
                'Malware blocked in an upload',
                'A file named "'.$file->name.'" scanned as infected and its public links were revoked.',
            );
        }
    }
}
