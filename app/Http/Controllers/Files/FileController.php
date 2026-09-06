<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Security\Detectors;
use App\Support\Security\SecurityAudit;
use App\Support\Files\FileType;
use App\Support\Files\Naming;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

class FileController extends BaseFilesController
{
    /** Direct (non-chunked) upload for a single small file. */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:'.(int) (FileType::MAX_BYTES / 1024)],
            'folder' => ['nullable', 'string'],
        ]);

        $user = $this->user($request);
        $folder = $this->resolveTarget($request, 'folder');
        abort_unless(FileAccess::canUploadTo($user, $folder), 403, 'Permission denied.');

        $upload = $request->file('file');
        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());

        $desired = $this->resolveName(
            $folder?->id, $user->id, $upload->getClientOriginalName(),
            $request->input('conflict'), $request->input('newName')
        );

        $stored = Vault::store($upload->getRealPath(), $meta['extension']);

        if ($request->input('conflict') === 'replace') {
            $existing = $this->existingQuery($folder?->id, $user->id, $desired)->first();
            if ($existing) {
                $file = Versions::replaceWithUpload($existing, $user, $stored, $meta);

                return response()->json($this->presenter($request)->file($file), 201);
            }
        }

        $file = DB::transaction(function () use ($folder, $user, $desired, $meta, $stored) {
            return FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $folder?->id,
                'name' => $desired,
                'extension' => $meta['extension'],
                'mime_type' => $meta['mime'],
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'owner_id' => $user->id,
                'uploaded_by' => $user->id,
            ]);
        });

        // The bytes just stored are version 1: history starts at creation, so
        // a file's current content is always inside its own version list.
        Versions::recordInitial($file, $user->id);

        Activity::forFile($user->id, $file, 'upload', ['size' => $file->size]);

        return response()->json($this->presenter($request)->file($file), 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($this->user($request), 'view', $file);

        return response()->json($this->presenter($request)->file($file));
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $request->validate(['name' => ['required', 'string', 'max:255']]);

        $file = $this->findFile($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'rename', $file);

        // Keep the real extension/MIME truthful; only the display name changes.
        $name = Naming::assertValid($request->input('name'));
        if ($this->existingQuery($file->folder_id, $file->owner_id, $name, $file->id)->exists()) {
            $name = Naming::nextAvailable($name, fn ($c) => $this->existingQuery($file->folder_id, $file->owner_id, $c, $file->id)->exists());
        }

        $before = $file->name;
        $file->update(['name' => $name]);
        Activity::forFile($user->id, $file, 'rename', ['from' => $before]);

        return response()->json($this->presenter($request)->file($file));
    }

    public function move(Request $request, string $uuid): JsonResponse
    {
        $file = $this->findFile($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'move', $file);

        $target = $this->resolveTarget($request);
        abort_unless(FileAccess::canUploadTo($user, $target), 403, 'Permission denied.');

        $name = Naming::nextAvailable(
            $file->name,
            fn ($c) => $this->existingQuery($target?->id, $file->owner_id, $c, $file->id)->exists()
        );

        $file->update(['folder_id' => $target?->id, 'name' => $name]);
        Activity::forFile($user->id, $file, 'move', ['to' => $target?->name]);

        return response()->json($this->presenter($request)->file($file));
    }

    public function copy(Request $request, string $uuid): JsonResponse
    {
        $file = $this->findFile($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'copy', $file);

        $target = $this->resolveTarget($request);
        abort_unless(FileAccess::canUploadTo($user, $target), 403, 'Permission denied.');

        $stored = Vault::duplicate($file);
        $name = Naming::nextAvailable(
            $file->name,
            fn ($c) => $this->existingQuery($target?->id, $user->id, $c)->exists()
        );

        $copy = FileItem::create([
            'uuid' => $stored['uuid'],
            'folder_id' => $target?->id,
            'name' => $name,
            'extension' => $file->extension,
            'mime_type' => $file->mime_type,
            'size' => $file->size,
            'disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'checksum' => $file->checksum,
            'owner_id' => $user->id,
            'uploaded_by' => $user->id,
        ]);

        Activity::forFile($user->id, $copy, 'copy', ['from' => $file->name]);

        return response()->json($this->presenter($request)->file($copy), 201);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $file = $this->findFile($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'delete', $file);

        $file->update(['deleted_by' => $user->id]);
        $file->delete();
        Activity::forFile($user->id, $file, 'delete');

        return response()->json(['ok' => true]);
    }

    public function restore(Request $request, string $uuid): JsonResponse
    {
        $file = $this->findFile($uuid, withTrashed: true);
        $user = $this->user($request);
        abort_unless($this->mayManageTrashed($user, $file), 403, 'Permission denied.');

        $file->restore();
        Activity::forFile($user->id, $file, 'restore');

        return response()->json($this->presenter($request)->file($file));
    }

    public function forceDelete(Request $request, string $uuid): JsonResponse
    {
        $file = $this->findFile($uuid, withTrashed: true);
        $user = $this->user($request);
        abort_unless($this->mayManageTrashed($user, $file), 403, 'Permission denied.');

        Vault::delete($file);
        $file->forceDelete();
        Activity::forFile($user->id, $file, 'purge', ['name' => $file->name]);

        return response()->json(['ok' => true]);
    }

    public function download(Request $request, string $uuid): SymfonyResponse
    {
        $file = $this->findFile($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'download', $file);

        Activity::forFile($user->id, $file, 'download');
        SecurityAudit::record('file.download', [
            'file_id' => $file->id,
            'uuid' => $file->uuid,
            'user_id' => $user->id,
        ]);
        Detectors::onFileDownload($user->id);

        return Vault::download($file);
    }

    public function preview(Request $request, string $uuid): SymfonyResponse
    {
        $file = $this->findFile($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'preview', $file);
        abort_unless(FileType::isPreviewable((string) $file->extension), 415, 'This file type can’t be previewed.');

        Activity::forFile($user->id, $file, 'preview');

        return Vault::preview($file);
    }

    /* ── name helpers ──────────────────────────────── */

    private function resolveName(?int $folderId, int $ownerId, string $filename, ?string $conflict, ?string $newName): string
    {
        if ($conflict === 'rename') {
            $name = Naming::assertValid((string) $newName);
            if ($this->existingQuery($folderId, $ownerId, $name)->exists()) {
                throw new \App\Support\Files\FileValidationException('A file with that name already exists here.');
            }

            return $name;
        }

        $name = Naming::assertValid($filename);
        if ($conflict === 'replace') {
            return $name;
        }

        return Naming::nextAvailable($name, fn ($c) => $this->existingQuery($folderId, $ownerId, $c)->exists());
    }

    private function existingQuery(?int $folderId, int $ownerId, string $name, ?int $ignoreId = null)
    {
        return FileItem::query()
            ->where('folder_id', $folderId)
            ->when($folderId === null, fn ($q) => $q->where('owner_id', $ownerId))
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId));
    }

    private function mayManageTrashed($user, FileItem $file): bool
    {
        return FileAccess::isAdmin($user)
            || $file->owner_id === $user->id
            || $file->deleted_by === $user->id;
    }
}
