<?php

namespace App\Support\Files;

use App\Models\Folder;

/**
 * Which files count as client documents, and therefore enter review.
 *
 * The rule is inheritance, not naming. A file is a client document if it sits
 * anywhere beneath a client folder — the client's own folder, one of the
 * default subfolders provisioned with it (Citizenship Applications, General
 * Citizenship Advisory, Approval Documents), or any folder a member of staff
 * creates inside those later.
 *
 * Matching on folder *names* was the obvious alternative and is a trap: the
 * default set is configurable, a client can rename a folder, and a folder
 * called "Approval Documents" somewhere unrelated would start pulling ordinary
 * files into a client's review queue.
 */
final class ClientDocuments
{
    /** Depth guard — a cycle in parent_id would otherwise hang the request. */
    private const MAX_DEPTH = 32;

    /** Resolved client id per folder id, for the life of the request. */
    private static array $cache = [];

    /**
     * The client this folder belongs to, if any.
     *
     * Walks up from the folder rather than reading one column: only the
     * client's root folder carries client_id, so a file two levels down inside
     * "Citizenship Applications" has no direct link to the client at all.
     */
    public static function clientIdFor(?int $folderId): ?int
    {
        if ($folderId === null) {
            return null;
        }

        if (array_key_exists($folderId, self::$cache)) {
            return self::$cache[$folderId];
        }

        $seen = [];
        $id = $folderId;
        $found = null;

        for ($depth = 0; $id !== null && $depth < self::MAX_DEPTH; $depth++) {
            if (isset($seen[$id])) {
                break;
            }
            $seen[$id] = true;

            $folder = Folder::query()
                ->select(['id', 'parent_id', 'folder_type', 'client_id'])
                ->find($id);

            if (! $folder) {
                break;
            }

            if ($folder->folder_type === Folder::TYPE_CLIENT && $folder->client_id !== null) {
                $found = (int) $folder->client_id;
                break;
            }

            $id = $folder->parent_id;
        }

        // Cache the whole walked chain, not just the folder asked about: an
        // upload of thirty files into one folder should not walk it thirty
        // times, and neither should its siblings.
        foreach (array_keys($seen) as $walked) {
            self::$cache[$walked] = $found;
        }

        return $found;
    }

    public static function isClientFolder(?int $folderId): bool
    {
        return self::clientIdFor($folderId) !== null;
    }

    /** Long-running processes (queue workers) must not hold this forever. */
    public static function forget(): void
    {
        self::$cache = [];
    }
}
