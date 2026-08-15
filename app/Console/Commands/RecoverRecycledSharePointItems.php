<?php

namespace App\Console\Commands;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Models\SharePointSyncLog;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use App\Support\SharePoint\Drive;
use App\Support\SharePoint\Pusher;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Model;
use Throwable;

/**
 * Take back out of the recycle bin everything OneDrive never deleted.
 *
 * The reconcile pass used to read a folder's FIRST PAGE of children as the
 * whole folder, so wherever a drive held more than 200 items in one place the
 * remainder looked deleted and was recycled — hundreds of files and folders
 * still sitting in OneDrive untouched. {@see Drive::childIds()} fixes the
 * cause; this fixes the damage it already did.
 *
 * The test applied to each one is the test the sync now applies: ask Graph. An
 * item Graph still hands over was never deleted and comes back; an item Graph
 * answers 404 for really is in OneDrive's recycle bin, and stays in the
 * portal's — that pairing is exactly what the firm asked for.
 *
 * Matching a Graph item back to its portal row is by parent and name, because
 * the mapping row was destroyed along with the delete. That is why this runs in
 * passes: re-linking a folder re-creates the mapping its children are matched
 * against, so each pass reaches one level deeper into the tree.
 */
class RecoverRecycledSharePointItems extends Command
{
    protected $signature = 'sharepoint:recover-recycled
        {--connection= : Only this connection id}
        {--dry-run : Report what would be restored without changing anything}';

    protected $description = 'Restore portal files recycled by mistake while they still exist in OneDrive';

    private bool $dryRun = false;

    /** @var array<string, int> */
    private array $tally = ['restored' => 0, 'gone' => 0, 'unmatched' => 0, 'failed' => 0];

    /** Portal rows already spoken for, so no mapping is ever stolen. */
    private array $mappedFileIds = [];

    private array $mappedFolderIds = [];

    private ?string $rootId = null;

    public function handle(): int
    {
        $this->dryRun = (bool) $this->option('dry-run');

        $connections = SharePointConnection::query()
            ->when($this->option('connection'), fn ($q, $id) => $q->where('id', $id))
            ->orderBy('id')
            ->get();

        foreach ($connections as $connection) {
            $this->line('<info>connection '.$connection->id.'</info> '.
                ($connection->owner_upn ?: $connection->drive_name ?: $connection->site_name));

            // A restore must not bounce back out as an upload: the bytes are
            // already in OneDrive, which is the whole reason we are putting
            // the portal's copy back.
            try {
                Pusher::suspend(fn () => $this->recover($connection));
            } catch (Throwable $e) {
                $this->error('  '.$e->getMessage());
            }
        }

        $this->newLine();
        $this->line('restored '.$this->tally['restored'].
            ', still deleted in OneDrive '.$this->tally['gone'].
            ', no portal row found '.$this->tally['unmatched'].
            ', failed '.$this->tally['failed'].
            ($this->dryRun ? '  (dry run — nothing was changed)' : ''));

        return self::SUCCESS;
    }

    private function recover(SharePointConnection $connection): void
    {
        $this->rootId = null;
        $this->loadMapped($connection);

        $pending = $this->candidates($connection);

        if ($pending === []) {
            $this->line('  nothing recycled');

            return;
        }

        $this->line('  checking '.count($pending).' recycled items against OneDrive');

        // Each pass re-links one more level of the tree. A pass that changes
        // nothing means the rest cannot be matched, and repeating it would only
        // spend Graph calls to reach the same answer.
        for ($pass = 0; $pass < 8 && $pending !== []; $pass++) {
            $deferred = [];
            $progress = 0;

            foreach ($pending as $graphId => $name) {
                try {
                    $outcome = $this->recoverOne($connection, (string) $graphId, $name);
                } catch (Throwable $e) {
                    $this->warn('  '.$name.': '.$e->getMessage());
                    $this->tally['failed']++;

                    continue;
                }

                if ($outcome === 'deferred') {
                    $deferred[$graphId] = $name;

                    continue;
                }

                $progress++;
            }

            $pending = $deferred;

            if ($progress === 0) {
                break;
            }
        }

        foreach ($pending as $name) {
            $this->line('  <comment>no portal row</comment> '.$name);
            $this->tally['unmatched']++;
        }
    }

    private function loadMapped(SharePointConnection $connection): void
    {
        // Across every connection, not just this one: a row already standing
        // for some other Graph item must not be claimed for this one.
        $this->mappedFileIds = SharePointItem::whereNotNull('file_id')->pluck('file_id')->flip()->all();
        $this->mappedFolderIds = SharePointItem::whereNotNull('folder_id')->pluck('folder_id')->flip()->all();
    }

    /**
     * Every Graph item this connection has ever recycled.
     *
     * The sync log is the only surviving record of the ones deleted back when a
     * delete destroyed the mapping; `recycled_at` covers everything since.
     *
     * @return array<string, string> graph item id => name
     */
    private function candidates(SharePointConnection $connection): array
    {
        $candidates = SharePointSyncLog::where('connection_id', $connection->id)
            ->where('action', 'deleted')
            ->whereNotNull('graph_item_id')
            ->orderBy('id')
            ->pluck('detail', 'graph_item_id')
            ->all();

        foreach (SharePointItem::where('connection_id', $connection->id)->whereNotNull('recycled_at')->get() as $mapping) {
            $candidates[$mapping->graph_item_id] = $mapping->name;
        }

        return array_map(fn ($name) => (string) ($name ?: 'item'), $candidates);
    }

    /** @return 'restored'|'gone'|'deferred'|'skipped' */
    private function recoverOne(SharePointConnection $connection, string $graphId, string $name): string
    {
        $remote = Drive::find($connection->drive_id, $graphId);

        if ($remote === null) {
            // Genuinely deleted in OneDrive: the recycle bin is where the firm
            // wants it, so this one is left exactly as it is.
            $this->tally['gone']++;

            return 'gone';
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('graph_item_id', $graphId)->first();

        if ($mapping) {
            if (! $mapping->isRecycled()) {
                return 'skipped';   // already healthy
            }

            if (! $this->dryRun) {
                Synchroniser::applyRestore($connection, $mapping);
            }
            $this->restored($name);

            return 'restored';
        }

        $parent = $this->portalParent($connection, $remote);

        // Its parent folder is itself still waiting to be re-linked; a later
        // pass will know where this belongs.
        return $parent === false
            ? 'deferred'
            : $this->relink($connection, $remote, $parent[0], $name);
    }

    /**
     * The portal folder a live Graph item sits in.
     *
     * `false` means "not known yet", which is a reason to wait rather than to
     * give up — telling that apart from "the top of the library" is what stops
     * a whole subtree being dumped into the connection root. A resolved answer
     * comes back wrapped, because null is itself a valid answer: a personal
     * OneDrive connection has no portal folder of its own, and its top-level
     * items live at the top of the library.
     *
     * @return array{0: ?Folder}|false
     */
    private function portalParent(SharePointConnection $connection, array $remote): array|false
    {
        $parentId = $remote['parentReference']['id'] ?? null;

        if (! $parentId || $parentId === $this->rootId($connection)) {
            return [$connection->folder];
        }

        $parentMapping = SharePointItem::where('connection_id', $connection->id)
            ->where('graph_item_id', $parentId)->first();

        if (! $parentMapping || ! $parentMapping->folder_id || $parentMapping->isRecycled()) {
            return false;
        }

        return [$parentMapping->trashedFolder()];
    }

    /** The Graph id of wherever this connection starts. */
    private function rootId(SharePointConnection $connection): ?string
    {
        return $this->rootId ??= $connection->root_item_id
            ?: (Drive::root($connection->drive_id)['id'] ?? null);
    }

    /** @return 'restored'|'deferred' */
    private function relink(SharePointConnection $connection, array $remote, ?Folder $parent, string $name): string
    {
        $cleaned = Naming::clean($remote['name'] ?? $name);
        $isFolder = isset($remote['folder']);

        $row = $isFolder
            ? $this->match(Folder::withTrashed()->where('parent_id', $parent?->id), $cleaned, $this->mappedFolderIds)
            : $this->match(FileItem::withTrashed()->where('folder_id', $parent?->id), $cleaned, $this->mappedFileIds);

        if (! $row) {
            return 'deferred';
        }

        if ($this->dryRun) {
            $this->restored($cleaned);

            return 'restored';
        }

        if ($row->trashed()) {
            $row instanceof Folder ? FolderTree::restoreTree($row) : $row->restore();
            $row->update(['deleted_by' => null]);
        }

        // Re-create the mapping the delete destroyed, so this item is never
        // imported a second time and the next sync knows what it is.
        $row instanceof Folder
            ? Synchroniser::mapFolder($connection, $remote, $row)
            : Synchroniser::mapFile($connection, $remote, $row);

        $row instanceof Folder
            ? $this->mappedFolderIds[$row->id] = true
            : $this->mappedFileIds[$row->id] = true;

        $this->restored($cleaned);

        return 'restored';
    }

    /**
     * The one unmapped portal row of this name in this folder.
     *
     * Strict on purpose. Two rows of the same name in the same place cannot be
     * told apart by name, and a guess would hang the mapping on the wrong file
     * — after which the sync would faithfully keep the wrong file up to date.
     * The one exception is a tie between a live row and a recycled one: the
     * recycled one is the row this delete created, and the live one is the copy
     * a later sync imported to replace it.
     */
    private function match($query, string $name, array $alreadyMapped): ?Model
    {
        $matches = (clone $query)->where('name', $name)->get()
            ->reject(fn (Model $row) => isset($alreadyMapped[$row->id]));

        if ($matches->count() === 1) {
            return $matches->first();
        }

        $trashed = $matches->filter(fn (Model $row) => $row->trashed());

        return $trashed->count() === 1 ? $trashed->first() : null;
    }

    private function restored(string $name): void
    {
        $this->tally['restored']++;
        $this->line('  <info>restored</info> '.$name);
    }
}
