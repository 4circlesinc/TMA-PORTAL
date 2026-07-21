<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Favorite;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Files\FileValidationException;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use App\Support\Files\Presenter;
use App\Support\Files\Vault;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Multi-select actions over a mixed set of files and folders. Each item is
 * authorized and processed independently, so one permission failure never
 * silently rolls back the rest — the response reports what succeeded/failed.
 */
class BulkController extends BaseFilesController
{
    public function handle(Request $request): JsonResponse
    {
        $request->validate([
            'action' => ['required', 'in:delete,restore,forceDelete,move,copy,favorite,unfavorite'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.type' => ['required', 'in:file,folder'],
            'items.*.id' => ['required', 'string'],
            'target' => ['nullable', 'string'],
        ]);

        $user = $this->user($request);
        $action = $request->input('action');
        $target = $this->resolveTarget($request);

        if (in_array($action, ['move', 'copy'], true)) {
            abort_unless(FileAccess::canUploadTo($user, $target), 403, 'Permission denied.');
        }

        $done = 0;
        $errors = [];
        // Only move/copy hand back a changed item (a new uuid for a copy, a
        // possibly collision-renamed name for either) - the frontend already
        // knows what to do locally for every other action from the id alone.
        $resultRefs = [];

        foreach ($request->input('items') as $ref) {
            try {
                $trashed = in_array($action, ['restore', 'forceDelete'], true);
                $item = $ref['type'] === 'file'
                    ? $this->findFile($ref['id'], $trashed)
                    : $this->findFolder($ref['id'], $trashed);

                $result = $this->apply($action, $item, $user, $target);
                if ($result !== null) {
                    $resultRefs[] = ['ref' => $ref, 'item' => $result];
                }
                $done++;
            } catch (FileValidationException $e) {
                $errors[] = ['id' => $ref['id'], 'message' => $e->getMessage()];
            } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
                $errors[] = ['id' => $ref['id'], 'message' => $e->getStatusCode() === 403 ? 'Permission denied.' : $e->getMessage()];
            }
        }

        $results = [];
        if ($resultRefs) {
            $files = array_values(array_filter(array_map(
                fn ($r) => $r['item'] instanceof FileItem ? $r['item'] : null, $resultRefs
            )));
            $folders = array_values(array_filter(array_map(
                fn ($r) => $r['item'] instanceof Folder ? $r['item'] : null, $resultRefs
            )));
            $presenter = new Presenter($user);
            $presenter->prime($files, $folders);
            $results = array_map(fn ($r) => [
                'id' => $r['ref']['id'],
                'type' => $r['ref']['type'],
                'item' => $r['item'] instanceof FileItem ? $presenter->file($r['item']) : $presenter->folder($r['item']),
            ], $resultRefs);
        }

        return response()->json(['ok' => empty($errors), 'processed' => $done, 'errors' => $errors, 'results' => $results]);
    }

    private function apply(string $action, FileItem|Folder $item, $user, ?Folder $target): FileItem|Folder|null
    {
        $isFile = $item instanceof FileItem;

        return match ($action) {
            'delete' => $this->delete($item, $user, $isFile),
            'restore' => $this->restore($item, $user, $isFile),
            'forceDelete' => $this->purge($item, $user, $isFile),
            'move' => $this->move($item, $user, $target, $isFile),
            'copy' => $this->copy($item, $user, $target, $isFile),
            'favorite' => $this->favorite($item, $user, $isFile, true),
            'unfavorite' => $this->favorite($item, $user, $isFile, false),
        };
    }

    private function delete(FileItem|Folder $item, $user, bool $isFile): void
    {
        FileAccess::authorize($user, 'delete', $item);
        if ($isFile) {
            $item->update(['deleted_by' => $user->id]);
            $item->delete();
            Activity::forFile($user->id, $item, 'delete');
        } else {
            FolderTree::softDeleteTree($item, $user->id);
            Activity::forFolder($user->id, $item, 'delete');
        }
    }

    private function restore(FileItem|Folder $item, $user, bool $isFile): void
    {
        abort_unless($this->mayManageTrashed($user, $item, $isFile), 403);
        if ($isFile) {
            $item->restore();
            Activity::forFile($user->id, $item, 'restore');
        } else {
            FolderTree::restoreTree($item);
            Activity::forFolder($user->id, $item, 'restore');
        }
    }

    private function purge(FileItem|Folder $item, $user, bool $isFile): void
    {
        abort_unless($this->mayManageTrashed($user, $item, $isFile), 403);
        if ($isFile) {
            Vault::delete($item);
            $item->forceDelete();
            Activity::forFile($user->id, $item, 'purge');
        } else {
            Activity::forFolder($user->id, $item, 'purge');
            FolderTree::purgeTree($item);
        }
    }

    private function move(FileItem|Folder $item, $user, ?Folder $target, bool $isFile): FileItem|Folder
    {
        FileAccess::authorize($user, 'move', $item);
        if ($isFile) {
            $name = Naming::nextAvailable($item->name, fn ($c) => FileItem::query()
                ->where('folder_id', $target?->id)->whereRaw('LOWER(name) = ?', [mb_strtolower($c)])
                ->where('id', '!=', $item->id)->exists());
            $item->update(['folder_id' => $target?->id, 'name' => $name]);
            Activity::forFile($user->id, $item, 'move');

            return $item;
        }

        FolderTree::move($item, $target);
        Activity::forFolder($user->id, $item, 'move');

        return $item;
    }

    private function copy(FileItem|Folder $item, $user, ?Folder $target, bool $isFile): FileItem|Folder
    {
        FileAccess::authorize($user, 'copy', $item);
        if ($isFile) {
            $stored = Vault::duplicate($item);
            $name = Naming::nextAvailable($item->name, fn ($c) => FileItem::query()
                ->where('folder_id', $target?->id)->whereRaw('LOWER(name) = ?', [mb_strtolower($c)])->exists());
            $copy = FileItem::create([
                'uuid' => $stored['uuid'], 'folder_id' => $target?->id, 'name' => $name,
                'extension' => $item->extension, 'mime_type' => $item->mime_type, 'size' => $item->size,
                'disk' => $stored['disk'], 'storage_path' => $stored['path'], 'checksum' => $item->checksum,
                'owner_id' => $user->id, 'uploaded_by' => $user->id,
            ]);
            Activity::forFile($user->id, $copy, 'copy');

            return $copy;
        }

        $copy = FolderTree::copy($item, $target, $user);
        Activity::forFolder($user->id, $copy, 'copy');

        return $copy;
    }

    private function favorite(FileItem|Folder $item, $user, bool $isFile, bool $on): void
    {
        FileAccess::authorize($user, 'view', $item);
        $type = $isFile ? 'file' : 'folder';

        if ($on) {
            Favorite::firstOrCreate(['user_id' => $user->id, 'item_type' => $type, 'item_id' => $item->id]);
        } else {
            Favorite::where('user_id', $user->id)->where('item_type', $type)->where('item_id', $item->id)->delete();
        }
    }

    private function mayManageTrashed($user, FileItem|Folder $item, bool $isFile): bool
    {
        return FileAccess::isAdmin($user)
            || $item->owner_id === $user->id
            || $item->deleted_by === $user->id;
    }
}
