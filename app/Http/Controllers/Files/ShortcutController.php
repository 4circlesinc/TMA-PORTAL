<?php

namespace App\Http\Controllers\Files;

use App\Models\ClientAssignment;
use App\Models\Folder;
use App\Models\FolderShortcut;
use App\Models\User;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderColours;
use App\Support\Files\FolderIcons;
use App\Support\Files\FolderProvisioner;
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
        $user = $this->user($request);

        return response()->json([
            'shortcuts' => $this->listFor($request),
            'groups' => $this->autoGroups($user),
        ]);
    }

    /**
     * Folders that appear in the sidebar automatically, without pinning:
     * the staff member's assigned client folders, the organization folders
     * they may see, and their own staff folder. Grouped so the sidebar can
     * label each section instead of mixing them with manual pins.
     *
     * @return array<string, array<int, array{id: string, name: string}>>
     */
    private function autoGroups(User $user): array
    {
        $assignedClients = Folder::where('folder_type', Folder::TYPE_CLIENT)
            ->whereIn('client_id', ClientAssignment::where('user_id', $user->id)->pluck('client_id'))
            ->orderBy('name')->get();

        $organization = Folder::where('folder_type', Folder::TYPE_ORGANIZATION)
            ->where('is_archived', false)
            ->orderBy('name')->get()
            ->filter(fn (Folder $f) => FileAccess::can($user, 'view', $f));

        $staff = Folder::where('folder_type', Folder::TYPE_STAFF)
            ->where('subject_user_id', $user->id)
            ->orderBy('name')->get();

        // The "Client Files" / "Staff Files" containers — a fast path to browse
        // every client/staff folder. Only visible to whoever may see the root
        // (administrators), so staff never get a shortcut listing all clients.
        // Ensure both exist so an admin always has the entry points, even before
        // the first client or staff folder is provisioned.
        if (FileAccess::isAdmin($user)) {
            FolderProvisioner::clientsRoot();
            FolderProvisioner::staffRoot();
        }

        $libraries = Folder::where('folder_type', Folder::TYPE_ROOT)
            ->orderBy('name')->get()
            ->filter(fn (Folder $f) => FileAccess::can($user, 'view', $f))
            ->values();

        // All default/system-type folders here — colour/icon are the one
        // admin-set values, no per-viewer preference lookup needed.
        $map = fn ($folders) => $folders->map(fn (Folder $f) => [
            'id' => $f->uuid,
            'name' => $f->name,
            'colour' => FolderColours::effective($f, null),
            'iconName' => FolderIcons::effective($f, null),
        ])->values()->all();

        return [
            'libraries' => $map($libraries),
            'assignedClients' => $map($assignedClients),
            'organization' => $map($organization),
            'staff' => $map($staff),
        ];
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

        $shortcuts = FolderShortcut::where('user_id', $user->id)
            ->orderBy('position')
            ->orderBy('id')
            ->with('folder.parent')
            ->get()
            // The folder relation is null once the folder is soft-deleted or purged.
            ->filter(fn (FolderShortcut $s) => $s->folder && FileAccess::can($user, 'view', $s->folder));

        $folderIds = $shortcuts->map(fn (FolderShortcut $s) => $s->folder->id)->values()->all();
        $prefRows = FolderColours::preferenceRows($user, $folderIds);

        return $shortcuts
            ->map(function (FolderShortcut $s) use ($prefRows) {
                $pref = $prefRows[$s->folder->id] ?? [];

                return [
                    'id' => $s->folder->uuid,
                    'name' => $s->folder->name,
                    'parent' => $s->folder->parent?->name,
                    'colour' => FolderColours::effective($s->folder, $pref['colour'] ?? null),
                    'iconName' => FolderIcons::effective($s->folder, $pref['iconName'] ?? null),
                ];
            })
            ->values()
            ->all();
    }
}
