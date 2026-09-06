<?php

namespace App\Support\Files;

use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\Folder;

/**
 * Identity-class files (passport bio pages, national IDs, CIP slots).
 * Public links for these must carry a password so a forwarded URL is not
 * enough to open someone's identification.
 */
final class IdentityDocuments
{
    public static function requiresLinkPassword(FileItem|Folder $item): bool
    {
        if ($item instanceof Folder) {
            return self::folderIsIdentity($item);
        }

        if ($item->relationLoaded('cipDocument') ? $item->cipDocument : $item->cipDocument()->exists()) {
            $slot = $item->cipDocument ?? CipDocument::query()->where('file_id', $item->id)->first();
            if ($slot && self::slotIsIdentity((string) $slot->type, (string) $slot->label)) {
                return true;
            }
        }

        if (self::nameLooksIdentity((string) $item->name)) {
            return true;
        }

        if ($item->folder_id) {
            $folder = $item->relationLoaded('folder') ? $item->folder : Folder::find($item->folder_id);
            if ($folder && self::folderIsIdentity($folder)) {
                return true;
            }
        }

        return false;
    }

    private static function folderIsIdentity(Folder $folder): bool
    {
        if (CipPerson::query()->where('folder_id', $folder->id)->exists()) {
            return true;
        }

        return self::nameLooksIdentity((string) $folder->name);
    }

    private static function slotIsIdentity(string $type, string $label): bool
    {
        $hay = strtolower($type.' '.$label);

        return str_contains($hay, 'passport')
            || str_contains($hay, 'national_id')
            || str_contains($hay, 'national id')
            || str_contains($hay, 'bio');
    }

    private static function nameLooksIdentity(string $name): bool
    {
        return (bool) preg_match('/passport|national.?id|bio.?page|birth.?cert/i', $name);
    }
}
