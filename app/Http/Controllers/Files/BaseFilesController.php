<?php

namespace App\Http\Controllers\Files;

use App\Http\Controllers\Controller;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\Presenter;
use Illuminate\Http\Request;

abstract class BaseFilesController extends Controller
{
    protected function user(Request $request): User
    {
        return $request->user();
    }

    protected function findFolder(string $uuid, bool $withTrashed = false): Folder
    {
        $folder = Folder::query()
            ->when($withTrashed, fn ($q) => $q->withTrashed())
            ->where('uuid', $uuid)
            ->first();

        abort_unless($folder, 404, 'Folder no longer exists.');

        return $folder;
    }

    protected function findFile(string $uuid, bool $withTrashed = false): FileItem
    {
        $file = FileItem::query()
            ->when($withTrashed, fn ($q) => $q->withTrashed())
            ->where('uuid', $uuid)
            ->first();

        abort_unless($file, 404, 'File no longer exists.');

        return $file;
    }

    protected function presenter(Request $request): Presenter
    {
        return new Presenter($this->user($request));
    }

    /** Resolve an optional target-folder uuid from the request (null = root). */
    protected function resolveTarget(Request $request, string $key = 'target'): ?Folder
    {
        $uuid = $request->input($key);

        return $uuid ? $this->findFolder($uuid) : null;
    }
}
