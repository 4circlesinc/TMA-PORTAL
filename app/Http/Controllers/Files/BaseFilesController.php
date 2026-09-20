<?php

namespace App\Http\Controllers\Files;

use App\Http\Controllers\Controller;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\MalwareScanner;
use App\Support\Files\Presenter;
use App\Support\Security\SecurityAudit;
use Illuminate\Http\Request;

abstract class BaseFilesController extends Controller
{
    protected function user(Request $request): User
    {
        return $request->user();
    }

    /**
     * Refuse to hand over bytes that scanned as infected.
     *
     * Public links have always been held to this ({@see PublicShareController}),
     * but the signed-in doors were not: a client folder is shared, so one
     * infected upload was reachable by every colleague who could open the
     * folder. Staff are not exempt — the risk is the reader's own machine, and
     * the people most likely to open a client's attachment are the ones
     * working the file.
     *
     * PENDING is deliberately allowed through. The scan is queued, so blocking
     * it would make a file unreachable for as long as the worker is behind,
     * and a stalled queue must not look like a broken vault.
     */
    protected function assertNotInfected(FileItem $file, ?User $reader = null): void
    {
        if (! MalwareScanner::isBlocked($file->malware_status)) {
            return;
        }

        SecurityAudit::record('file.blocked_infected', [
            'file_id' => $file->id,
            'uuid' => $file->uuid,
            'user_id' => $reader?->id,
        ]);

        abort(403, 'This file was blocked by a malware scan.');
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
