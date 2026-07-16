<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
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
            'fileCount' => $stats['fileCount'],
            'folderCount' => $stats['folderCount'],
            'size' => $stats['size'],
            'sizeLabel' => $stats['size'] === null ? null : self::humanSize((int) $stats['size']),
            'parent' => $folder->parent ? ['id' => $folder->parent->uuid, 'name' => $folder->parent->name] : null,
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
