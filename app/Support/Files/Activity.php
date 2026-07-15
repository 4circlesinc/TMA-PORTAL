<?php

namespace App\Support\Files;

use App\Models\FileActivity;
use App\Models\FileItem;
use App\Models\Folder;
use Illuminate\Support\Facades\Request;

/**
 * Writes the file-activity log. One call per meaningful action
 * (upload, download, rename, move, share, delete, restore, …).
 */
class Activity
{
    public static function log(?int $userId, string $itemType, int $itemId, string $action, array $meta = []): void
    {
        FileActivity::create([
            'user_id' => $userId,
            'item_type' => $itemType,
            'item_id' => $itemId,
            'action' => $action,
            'meta' => $meta ?: null,
            'ip' => Request::ip(),
            'created_at' => now(),
        ]);
    }

    public static function forFile(?int $userId, FileItem $file, string $action, array $meta = []): void
    {
        self::log($userId, 'file', $file->id, $action, array_merge(['name' => $file->name], $meta));
    }

    public static function forFolder(?int $userId, Folder $folder, string $action, array $meta = []): void
    {
        self::log($userId, 'folder', $folder->id, $action, array_merge(['name' => $folder->name], $meta));
    }
}
