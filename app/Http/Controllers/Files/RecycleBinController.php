<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Files\Vault;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RecycleBinController extends BaseFilesController
{
    /** Permanently delete everything in the caller's recycle bin. */
    public function empty(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $isAdmin = FileAccess::isAdmin($user);

        $files = FileItem::onlyTrashed()
            ->when(! $isAdmin, fn ($q) => $q->where('owner_id', $user->id))
            ->get();

        $files->each(fn (FileItem $f) => Vault::delete($f));

        $fileCount = $files->count();
        $folderCount = Folder::onlyTrashed()
            ->when(! $isAdmin, fn ($q) => $q->where('owner_id', $user->id))
            ->count();

        DB::transaction(function () use ($user, $isAdmin) {
            FileItem::onlyTrashed()
                ->when(! $isAdmin, fn ($q) => $q->where('owner_id', $user->id))
                ->forceDelete();

            Folder::onlyTrashed()
                ->when(! $isAdmin, fn ($q) => $q->where('owner_id', $user->id))
                ->forceDelete();
        });

        Activity::log($user->id, 'recycle', 0, 'purge', ['files' => $fileCount, 'folders' => $folderCount]);

        return response()->json(['ok' => true, 'files' => $fileCount, 'folders' => $folderCount]);
    }
}
