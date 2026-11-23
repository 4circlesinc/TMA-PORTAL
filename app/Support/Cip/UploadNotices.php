<?php

namespace App\Support\Cip;

use App\Jobs\SendCipUploadNotice;
use App\Models\CipApplication;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Support\Facades\Cache;

/**
 * Telling the file's people that the provider side uploaded something.
 *
 * Every door ends in a FileItem landing in the application's folder tree, or
 * a new version of one, so that is where this listens: the checklist, the
 * Additional Documents box, intake, the library, and a request link alike.
 *
 * Gathered per sitting. A firm dropping twelve scans hears as one notice two
 * minutes after the first, naming all twelve, not as twelve letters.
 */
class UploadNotices
{
    public const DELAY_MINUTES = 2;

    /**
     * @param  User|null  $uploader  the provider-side account; null for a request-link visitor
     * @param  string|null  $visitor  the name a request-link visitor typed
     */
    public static function filed(FileItem $file, ?User $uploader, ?string $visitor = null): void
    {
        // Staff uploads are the firm's own work; only the provider side is news.
        if ($uploader !== null && Role::isStaff($uploader)) {
            return;
        }
        if ($uploader === null && $visitor === null) {
            return;
        }

        $application = self::applicationFor($file);
        if ($application === null || $application->status === Status::DRAFT) {
            return;
        }

        $key = 'cip-upload:'.$application->id.':'.($uploader?->id ?? 'visitor:'.mb_strtolower(trim($visitor)));

        try {
            $first = Cache::lock($key.':lock', 10)->block(5, function () use ($key, $file) {
                $names = Cache::get($key, []);
                $names[$file->id] = $file->name;
                Cache::put($key, $names, now()->addMinutes(self::DELAY_MINUTES + 30));

                return count($names) === 1;
            });

            // Outside the lock: a sync queue runs the job now, and it takes the same lock.
            if ($first) {
                SendCipUploadNotice::dispatch($key, $application->id, $uploader?->id, $visitor)
                    ->delay(now()->addMinutes(self::DELAY_MINUTES));
            }
        } catch (\Throwable $e) {
            // The file is filed either way; a notice that failed must not fail the upload.
            report($e);
        }
    }

    /** The sitting's file names, emptied so the next upload starts a new one. */
    public static function take(string $key): array
    {
        return Cache::lock($key.':lock', 10)->block(5, fn () => array_values(Cache::pull($key, [])));
    }

    /** The application whose folder tree holds this file, if any. */
    public static function applicationFor(FileItem $file): ?CipApplication
    {
        if ($application = $file->cipDocument?->application) {
            return $application;
        }

        $folder = $file->folder_id ? Folder::find($file->folder_id) : null;
        while ($folder !== null) {
            $application = CipApplication::query()
                ->where('folder_id', $folder->id)
                ->orWhere('post_approval_folder_id', $folder->id)
                ->first();
            if ($application !== null) {
                return $application;
            }
            $folder = $folder->parent_id ? Folder::find($folder->parent_id) : null;
        }

        return null;
    }
}
