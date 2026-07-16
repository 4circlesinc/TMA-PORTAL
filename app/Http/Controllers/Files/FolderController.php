<?php

namespace App\Http\Controllers\Files;

use App\Models\Folder;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FolderController extends BaseFilesController
{
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'parent' => ['nullable', 'string'],
            'auto' => ['sometimes', 'boolean'],
        ]);

        $user = $this->user($request);
        $parent = $this->resolveTarget($request, 'parent');

        abort_unless(FileAccess::canUploadTo($user, $parent), 403, 'Permission denied.');

        $folder = $request->boolean('auto')
            ? FolderTree::createAutoNamed($user, $request->input('name'), $parent)
            : FolderTree::create($user, $request->input('name'), $parent);
        Activity::forFolder($user->id, $folder, 'create');

        return response()->json($this->presenter($request)->folder($folder), 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $folder = $this->findFolder($uuid, withTrashed: true);
        FileAccess::authorize($this->user($request), 'view', $folder);

        return response()->json($this->presenter($request)->folder($folder));
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $request->validate(['name' => ['required', 'string', 'max:255']]);

        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'rename', $folder);

        $before = $folder->name;
        $folder = FolderTree::rename($folder, $request->input('name'));
        Activity::forFolder($user->id, $folder, 'rename', ['from' => $before]);

        return response()->json($this->presenter($request)->folder($folder));
    }

    public function move(Request $request, string $uuid): JsonResponse
    {
        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'move', $folder);

        $target = $this->resolveTarget($request);
        abort_unless(FileAccess::canUploadTo($user, $target), 403, 'Permission denied.');

        $folder = FolderTree::move($folder, $target);
        Activity::forFolder($user->id, $folder, 'move', ['to' => $target?->name]);

        return response()->json($this->presenter($request)->folder($folder));
    }

    public function copy(Request $request, string $uuid): JsonResponse
    {
        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'copy', $folder);

        $target = $this->resolveTarget($request);
        abort_unless(FileAccess::canUploadTo($user, $target), 403, 'Permission denied.');

        $copy = FolderTree::copy($folder, $target, $user);
        Activity::forFolder($user->id, $copy, 'copy', ['from' => $folder->name]);

        return response()->json($this->presenter($request)->folder($copy), 201);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'delete', $folder);

        FolderTree::softDeleteTree($folder, $user->id);
        Activity::forFolder($user->id, $folder, 'delete');

        return response()->json(['ok' => true]);
    }

    public function restore(Request $request, string $uuid): JsonResponse
    {
        $folder = $this->findFolder($uuid, withTrashed: true);
        $user = $this->user($request);
        abort_unless($this->mayManageTrashed($user, $folder), 403, 'Permission denied.');

        FolderTree::restoreTree($folder);
        Activity::forFolder($user->id, $folder, 'restore');

        return response()->json($this->presenter($request)->folder($folder));
    }

    public function forceDelete(Request $request, string $uuid): JsonResponse
    {
        $folder = $this->findFolder($uuid, withTrashed: true);
        $user = $this->user($request);
        abort_unless($this->mayManageTrashed($user, $folder), 403, 'Permission denied.');

        Activity::forFolder($user->id, $folder, 'purge', ['name' => $folder->name]);
        FolderTree::purgeTree($folder);

        return response()->json(['ok' => true]);
    }

    public function download(Request $request, string $uuid): StreamedResponse
    {
        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'download', $folder);

        $zipPath = FolderTree::zip($folder);
        Activity::forFolder($user->id, $folder, 'download', ['as' => 'zip']);

        return response()->streamDownload(function () use ($zipPath) {
            $stream = fopen($zipPath, 'rb');
            while ($stream && ! feof($stream)) {
                echo fread($stream, 8192);
                flush();
            }
            if ($stream) {
                fclose($stream);
            }
            @unlink($zipPath);
        }, $folder->name.'.zip', [
            'Content-Type' => 'application/zip',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function mayManageTrashed($user, Folder $folder): bool
    {
        return FileAccess::isAdmin($user)
            || $folder->owner_id === $user->id
            || $folder->deleted_by === $user->id;
    }
}
