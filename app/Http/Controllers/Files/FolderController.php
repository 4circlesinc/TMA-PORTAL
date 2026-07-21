<?php

namespace App\Http\Controllers\Files;

use App\Models\Folder;
use App\Models\FolderColourPreference;
use App\Models\User;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderColours;
use App\Support\Files\FolderIcons;
use App\Support\Files\FolderTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
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

    /**
     * Regular folders: the caller's own colour preference, personal to them.
     * Default/system folders: the one official colour, admin-only, shared
     * by everyone who can see the folder. `colour: null` resets either.
     */
    public function colour(Request $request, string $uuid): JsonResponse
    {
        $request->validate([
            'colour' => ['nullable', 'string', Rule::in(array_keys(FolderColours::PALETTE))],
        ]);

        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'view', $folder);
        $colour = $request->input('colour');

        if ($folder->folder_type === Folder::TYPE_USER) {
            $this->setPreferenceField($folder, $user, 'colour', $colour);
        } else {
            abort_unless(FileAccess::isAdmin($user), 403, "Only administrators can change this folder's colour.");
            $folder->update(['colour' => $colour]);
        }

        Activity::forFolder($user->id, $folder, 'colour', ['colour' => $colour]);

        return response()->json($this->presenter($request)->folder($folder));
    }

    /**
     * Same personal-vs-admin-global split as colour(), for the folder's
     * front-panel icon stamp. `icon: null` resets either.
     */
    public function icon(Request $request, string $uuid): JsonResponse
    {
        $request->validate([
            'icon' => ['nullable', 'string', Rule::in(FolderIcons::all())],
        ]);

        $folder = $this->findFolder($uuid);
        $user = $this->user($request);
        FileAccess::authorize($user, 'view', $folder);
        $icon = $request->input('icon');

        if ($folder->folder_type === Folder::TYPE_USER) {
            $this->setPreferenceField($folder, $user, 'icon_name', $icon);
        } else {
            abort_unless(FileAccess::isAdmin($user), 403, "Only administrators can change this folder's icon.");
            $folder->update(['icon_name' => $icon]);
        }

        Activity::forFolder($user->id, $folder, 'icon', ['icon' => $icon]);

        return response()->json($this->presenter($request)->folder($folder));
    }

    /**
     * Personal colour and icon preferences share one row per (user, folder).
     * Clearing one field must not blow away the other — only drop the row
     * once both are empty.
     */
    private function setPreferenceField(Folder $folder, User $user, string $column, ?string $value): void
    {
        if ($value === null) {
            $row = FolderColourPreference::where('user_id', $user->id)->where('folder_id', $folder->id)->first();
            if (! $row) {
                return;
            }
            $row->{$column} = null;
            if ($row->colour === null && $row->icon_name === null) {
                $row->delete();
            } else {
                $row->save();
            }

            return;
        }

        FolderColourPreference::updateOrCreate(
            ['user_id' => $user->id, 'folder_id' => $folder->id],
            [$column => $value]
        );
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
