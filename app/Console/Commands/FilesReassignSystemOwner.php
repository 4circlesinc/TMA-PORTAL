<?php

namespace App\Console\Commands;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\Files\FolderProvisioner;
use Illuminate\Console\Command;

/**
 * Put the firm's own files under the firm's own account.
 *
 * Everything a *site* connection syncs is firm content — the citizenship
 * libraries, the advisory files, the post-approval documents. The sync used to
 * file all of it under `created_by`, which was whichever administrator set the
 * connection up, so thirty thousand documents nobody thought of as one
 * person's were attributed to that person and the Owner column read as a wall
 * of their name.
 *
 * Deliberately NOT touched:
 *
 *  - OneDrive connections. Those files belong to the person whose drive it is
 *    and are private to them; moving their owner would change who can reach
 *    them (see FileAccess::personalSpaceOwner, which is checked before the
 *    administrator short-circuit).
 *  - Anything created in the portal itself. A file somebody uploaded is theirs,
 *    and its owner is a fact rather than a default.
 *
 * Safe to re-run: it only ever moves rows that are not already correct.
 */
class FilesReassignSystemOwner extends Command
{
    protected $signature = 'files:reassign-system-owner {--dry-run : Report what would change and stop}';

    protected $description = "Attribute site-synced files and folders to the firm's own account";

    public function handle(): int
    {
        $ownerId = FolderProvisioner::systemAccountId();

        if (! $ownerId) {
            $this->warn(sprintf(
                'No account matches portal.system_account_email (%s) — nothing to do.',
                config('portal.system_account_email') ?: '(unset)'
            ));

            // Not a failure: an install without a service account is a valid
            // state, and the caller is usually a migration.
            return self::SUCCESS;
        }

        $siteConnections = SharePointConnection::query()
            ->where('drive_kind', '!=', 'onedrive')
            ->pluck('id');

        if ($siteConnections->isEmpty()) {
            $this->info('No site connections; nothing to reassign.');

            return self::SUCCESS;
        }

        $files = $this->idsFor($siteConnections, 'file_id');
        $folders = $this->idsFor($siteConnections, 'folder_id');

        $fileCount = FileItem::withTrashed()->whereIn('id', $files)->where('owner_id', '!=', $ownerId)->count();
        $folderCount = Folder::withTrashed()->whereIn('id', $folders)->where('owner_id', '!=', $ownerId)->count();

        $this->info(sprintf(
            '%s: %d file(s) and %d folder(s) to move to account #%d.',
            $this->option('dry-run') ? 'Would reassign' : 'Reassigning',
            $fileCount,
            $folderCount,
            $ownerId
        ));

        if ($this->option('dry-run')) {
            return self::SUCCESS;
        }

        // Chunked: this is tens of thousands of rows against a remote database,
        // and one IN (…) of that size is a query no planner enjoys.
        $moved = ['files' => 0, 'folders' => 0];

        foreach ($files->chunk(2000) as $chunk) {
            $moved['files'] += FileItem::withTrashed()
                ->whereIn('id', $chunk)->where('owner_id', '!=', $ownerId)
                ->update(['owner_id' => $ownerId]);
        }

        foreach ($folders->chunk(2000) as $chunk) {
            $moved['folders'] += Folder::withTrashed()
                ->whereIn('id', $chunk)->where('owner_id', '!=', $ownerId)
                ->update(['owner_id' => $ownerId]);
        }

        $this->info(sprintf('Moved %d file(s) and %d folder(s).', $moved['files'], $moved['folders']));

        return self::SUCCESS;
    }

    /**
     * @param  \Illuminate\Support\Collection<int, int>  $connectionIds
     * @return \Illuminate\Support\Collection<int, int>
     */
    private function idsFor($connectionIds, string $column)
    {
        return SharePointItem::query()
            ->whereIn('connection_id', $connectionIds)
            ->whereNotNull($column)
            ->pluck($column);
    }
}
