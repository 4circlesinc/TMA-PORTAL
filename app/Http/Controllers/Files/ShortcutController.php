<?php

namespace App\Http\Controllers\Files;

use App\Models\Folder;
use App\Models\FolderShortcut;
use App\Support\Files\FileAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Sidebar folder shortcuts — each user's own pinned folders.
 *
 * A shortcut is only ever a pointer: the listing re-checks the folder still
 * exists and that the viewer may still see it, so a deleted folder or a
 * revoked share drops out of the sidebar on the next load rather than
 * offering a dead link.
 */
class ShortcutController extends BaseFilesController
{
    private const MAX = 30;

    public function index(Request $request): JsonResponse
    {
        return response()->json(['shortcuts' => $this->listFor($request)]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate(['folder' => ['required', 'string']]);

        $user = $this->user($request);
        $folder = $this->findFolder($request->input('folder'));
        FileAccess::authorize($user, 'view', $folder);

        $existing = FolderShortcut::where('user_id', $user->id)
            ->where('folder_id', $folder->id)
            ->first();

        // Already pinned — succeed quietly rather than creating a duplicate.
        if (! $existing) {
            $count = FolderShortcut::where('user_id', $user->id)->count();
            abort_if($count >= self::MAX, 422, 'You can pin up to '.self::MAX.' folders.');

            FolderShortcut::create([
                'user_id' => $user->id,
                'folder_id' => $folder->id,
                'position' => $count,
            ]);
        }

        return response()->json(['shortcuts' => $this->listFor($request)], $existing ? 200 : 201);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        // withTrashed: a shortcut to a deleted folder must still be removable.
        $folder = $this->findFolder($uuid, withTrashed: true);

        FolderShortcut::where('user_id', $user->id)
            ->where('folder_id', $folder->id)
            ->delete();

        return response()->json(['shortcuts' => $this->listFor($request)]);
    }

    /** Persist a new order. Ids the user hasn't pinned are ignored. */
    public function reorder(Request $request): JsonResponse
    {
        $request->validate([
            'order' => ['required', 'array', 'max:'.self::MAX],
            'order.*' => ['string'],
        ]);

        $user = $this->user($request);

        $byUuid = Folder::withTrashed()
            ->whereIn('uuid', $request->input('order'))
            ->pluck('id', 'uuid');

        $position = 0;
        foreach ($request->input('order') as $uuid) {
            if (! isset($byUuid[$uuid])) {
                continue;
            }
            FolderShortcut::where('user_id', $user->id)
                ->where('folder_id', $byUuid[$uuid])
                ->update(['position' => $position++]);
        }

        return response()->json(['shortcuts' => $this->listFor($request)]);
    }

    /**
     * The viewer's live shortcuts: existing folders they can still view, in
     * their chosen order.
     *
     * @return array<int, array{id: string, name: string, parent: ?string}>
     */
    private function listFor(Request $request): array
    {
        $user = $this->user($request);

        return FolderShortcut::where('user_id', $user->id)
            ->orderBy('position')
            ->orderBy('id')
            ->with('folder.parent')
            ->get()
            // The folder relation is null once the folder is soft-deleted or purged.
            ->filter(fn (FolderShortcut $s) => $s->folder && FileAccess::can($user, 'view', $s->folder))
            ->map(fn (FolderShortcut $s) => [
                'id' => $s->folder->uuid,
                'name' => $s->folder->name,
                'parent' => $s->folder->parent?->name,
            ])
            ->values()
            ->all();
    }
}
