<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\FolderColourPreference;
use App\Models\Share;
use App\Models\User;

/**
 * Shapes files/folders into safe JSON for the client. Only the public uuid is
 * ever exposed — never the database id, storage path, or disk. Favourite and
 * share/assignment status are primed in bulk to avoid N+1 queries in listings.
 */
class Presenter
{
    private array $favFile = [];
    private array $favFolder = [];
    /** item_id => array of assignee display names */
    private array $assignFile = [];
    private array $assignFolder = [];
    /** folder_id => viewer's personal ['colour'=>?, 'iconName'=>?] preference (user-type folders only) */
    private array $prefRows = [];
    /** id => Folder, all non-trashed folders, lazily loaded once for path-building. */
    private ?array $folderIndex = null;

    public function __construct(private User $viewer)
    {
    }

    /**
     * @param  FileItem[]  $files
     * @param  Folder[]  $folders
     */
    public function prime(array $files, array $folders): void
    {
        $fileIds = array_values(array_map(fn ($f) => $f->id, $files));
        $folderIds = array_values(array_map(fn ($f) => $f->id, $folders));

        if ($fileIds) {
            $this->favFile = $this->viewer->favorites()
                ->where('item_type', 'file')->whereIn('item_id', $fileIds)
                ->pluck('item_id')->flip()->all();
        }
        if ($folderIds) {
            $this->favFolder = $this->viewer->favorites()
                ->where('item_type', 'folder')->whereIn('item_id', $folderIds)
                ->pluck('item_id')->flip()->all();
        }

        $this->assignFile = $this->assigneeMap('file', $fileIds);
        $this->assignFolder = $this->assigneeMap('folder', $folderIds);
        $this->prefRows = FolderColours::preferenceRows($this->viewer, $folderIds);
    }

    public function file(FileItem $file): array
    {
        $ext = (string) $file->extension;
        $assignees = $this->assignFile[$file->id]
            ?? $this->assigneeNames('file', $file->id);

        return [
            'id' => $file->uuid,
            'type' => 'file',
            'name' => $file->name,
            'extension' => $ext,
            'category' => FileType::category($ext),
            'mime' => $file->mime_type,
            'icon' => FileType::icon($ext),
            'previewable' => FileType::isPreviewable($ext),
            'size' => (int) $file->size,
            'sizeLabel' => self::humanSize((int) $file->size),
            'folder' => $file->folder ? ['id' => $file->folder->uuid, 'name' => $file->folder->name] : null,
            'path' => $this->folderPath($file->folder),
            'createdAt' => optional($file->created_at)->toIso8601String(),
            'uploadedAt' => optional($file->created_at)->toIso8601String(),
            'modifiedAt' => optional($file->source_modified_at ?? $file->updated_at)->toIso8601String(),
            'updatedAt' => optional($file->updated_at)->toIso8601String(),
            'deletedAt' => optional($file->deleted_at)->toIso8601String(),
            'owner' => $this->person($file->owner),
            'uploadedBy' => $this->person($file->uploader),
            'assignedTo' => $assignees,
            'shared' => count($assignees) > 0,
            'favorite' => isset($this->favFile[$file->id]),
            'permissions' => $this->filePerms($file),
            'downloadUrl' => route('files.download', $file->uuid),
            'previewUrl' => FileType::isPreviewable($ext)
                ? route('files.preview', $file->uuid)
                : (strtolower($ext) === 'svg' ? route('files.thumb', $file->uuid) : null),
            'thumbUrl' => Thumbnail::supportsExt($ext) ? route('files.thumb', $file->uuid) : null,
        ];
    }

    public function folder(Folder $folder, bool $withStats = true): array
    {
        $assignees = $this->assignFolder[$folder->id]
            ?? $this->assigneeNames('folder', $folder->id);

        $stats = $withStats ? FolderTree::aggregate($folder) : ['fileCount' => null, 'folderCount' => null, 'size' => null];

        return [
            'id' => $folder->uuid,
            'type' => 'folder',
            'name' => $folder->name,
            'folderType' => $folder->folder_type,
            'colour' => $this->effectiveColour($folder),
            'iconName' => $this->effectiveIcon($folder),
            'fileCount' => $stats['fileCount'],
            'folderCount' => $stats['folderCount'],
            'size' => $stats['size'],
            'sizeLabel' => $stats['size'] === null ? null : self::humanSize((int) $stats['size']),
            'parent' => $folder->parent ? ['id' => $folder->parent->uuid, 'name' => $folder->parent->name] : null,
            'path' => $this->folderPath($folder->parent),
            'createdAt' => optional($folder->created_at)->toIso8601String(),
            'modifiedAt' => optional($folder->updated_at)->toIso8601String(),
            'deletedAt' => optional($folder->deleted_at)->toIso8601String(),
            'owner' => $this->person($folder->owner),
            'createdBy' => $this->person($folder->creator),
            'assignedTo' => $assignees,
            'shared' => count($assignees) > 0,
            'favorite' => isset($this->favFolder[$folder->id]),
            'permissions' => $this->folderPerms($folder),
        ];
    }

    /**
     * Full ancestor chain for a folder, root-first, including the folder
     * itself — e.g. for `file()`, pass the file's direct folder and get back
     * every containing folder down to it, so the client can render a full
     * path instead of just the immediate parent's name. Walks an in-memory
     * id => Folder map (one query total, however many items are being
     * presented) rather than lazy-loading `->parent` per item, which would
     * be an N+1 query per ancestor level for a list of files/folders.
     */
    private function folderPath(?Folder $folder): array
    {
        if (! $folder) {
            return [];
        }

        $index = $this->folderIndex();
        $trail = [];
        $seen = [];
        $node = $folder;

        while ($node && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            array_unshift($trail, ['id' => $node->uuid, 'name' => $node->name]);
            $node = $node->parent_id ? ($index[$node->parent_id] ?? null) : null;
        }

        return $trail;
    }

    private function folderIndex(): array
    {
        if ($this->folderIndex === null) {
            $this->folderIndex = Folder::query()
                ->select('id', 'uuid', 'name', 'parent_id')
                ->get()->keyBy('id')->all();
        }

        return $this->folderIndex;
    }

    /**
     * Default/system folders show the one admin-set colour/icon. Regular
     * user folders show the viewer's own preference — primed in bulk by
     * prime(), with a single lazy lookup for callers that skip priming
     * (store/show/move/copy/restore/colour/icon all present one folder at
     * a time).
     */
    private function effectiveColour(Folder $folder): ?string
    {
        if ($folder->folder_type !== Folder::TYPE_USER) {
            return $folder->colour;
        }

        return $this->personalPreference($folder)['colour'] ?? null;
    }

    private function effectiveIcon(Folder $folder): ?string
    {
        if ($folder->folder_type !== Folder::TYPE_USER) {
            return $folder->icon_name;
        }

        return $this->personalPreference($folder)['iconName'] ?? null;
    }

    /** @return array{colour: ?string, iconName: ?string} */
    private function personalPreference(Folder $folder): array
    {
        if (array_key_exists($folder->id, $this->prefRows)) {
            return $this->prefRows[$folder->id];
        }

        $row = FolderColourPreference::where('user_id', $this->viewer->id)
            ->where('folder_id', $folder->id)->first(['colour', 'icon_name']);

        $resolved = ['colour' => $row?->colour, 'iconName' => $row?->icon_name];
        $this->prefRows[$folder->id] = $resolved;

        return $resolved;
    }

    private function filePerms(FileItem $file): array
    {
        return [
            'preview' => FileAccess::can($this->viewer, 'preview', $file),
            'download' => FileAccess::can($this->viewer, 'download', $file),
            'rename' => FileAccess::can($this->viewer, 'rename', $file),
            'move' => FileAccess::can($this->viewer, 'move', $file),
            'copy' => FileAccess::can($this->viewer, 'copy', $file),
            'delete' => FileAccess::can($this->viewer, 'delete', $file),
            'share' => FileAccess::can($this->viewer, 'share', $file),
            'assign' => FileAccess::can($this->viewer, 'assign', $file),
        ];
    }

    private function folderPerms(Folder $folder): array
    {
        return [
            'upload' => FileAccess::can($this->viewer, 'upload', $folder),
            'download' => FileAccess::can($this->viewer, 'download', $folder),
            'rename' => FileAccess::can($this->viewer, 'rename', $folder),
            'move' => FileAccess::can($this->viewer, 'move', $folder),
            'copy' => FileAccess::can($this->viewer, 'copy', $folder),
            'delete' => FileAccess::can($this->viewer, 'delete', $folder),
            'share' => FileAccess::can($this->viewer, 'share', $folder),
            'assign' => FileAccess::can($this->viewer, 'assign', $folder),
            // Regular folders: anyone who can see it may set their own colour/icon.
            // Default/system folders: admin-only, since it's shared.
            'colour' => $folder->folder_type === Folder::TYPE_USER
                ? FileAccess::can($this->viewer, 'view', $folder)
                : FileAccess::isAdmin($this->viewer),
            'icon' => $folder->folder_type === Folder::TYPE_USER
                ? FileAccess::can($this->viewer, 'view', $folder)
                : FileAccess::isAdmin($this->viewer),
        ];
    }

    private function person(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->avatar_url,
        ];
    }

    private function assigneeMap(string $type, array $ids): array
    {
        if (! $ids) {
            return [];
        }

        $map = [];
        Share::query()
            ->where('kind', 'user')
            ->where('item_type', $type)
            ->whereIn('item_id', $ids)
            ->whereNull('revoked_at')
            ->with('targetUser:id,name')
            ->get()
            ->filter(fn (Share $s) => $s->isActive())
            ->each(function (Share $s) use (&$map) {
                if ($s->targetUser) {
                    $map[$s->item_id][] = $s->targetUser->name;
                }
            });

        return $map;
    }

    private function assigneeNames(string $type, int $id): array
    {
        return $this->assigneeMap($type, [$id])[$id] ?? [];
    }

    public static function humanSize(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $power = min((int) floor(log($bytes, 1024)), count($units) - 1);
        $value = $bytes / (1024 ** $power);

        return ($power === 0 ? (int) $value : round($value, 1)).' '.$units[$power];
    }
}
