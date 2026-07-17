<?php

namespace App\Http\Controllers;

use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Naming;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Administrator configuration for the File Library: the default subfolders
 * created for every new client, whether new staff get a personal folder, and
 * the organization (shared internal) folders. Selecting *which* staff may see
 * an organization folder reuses the existing Assign/share flow; this controller
 * only creates the folder and sets its audience.
 */
class FileLibraryController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        return response()->json([
            'settings' => FileLibrarySetting::current(),
            'organizationFolders' => $this->organizationFolders(),
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'clientSubfolders' => ['sometimes', 'array'],
            'clientSubfolders.*' => ['nullable', 'string', 'max:255'],
            'autoCreateStaffFolder' => ['sometimes', 'boolean'],
        ]);

        if (isset($data['clientSubfolders'])) {
            $data['clientSubfolders'] = array_values(array_filter(array_map(
                fn ($n) => Naming::clean((string) $n),
                $data['clientSubfolders'],
            )));
        }

        return response()->json(['settings' => FileLibrarySetting::put($data)]);
    }

    public function storeOrganizationFolder(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'audience' => ['required', Rule::in(['all_staff', 'selected'])],
            'role' => ['sometimes', Rule::in(['viewer', 'editor'])],
        ]);

        $name = Naming::clean($data['name']);
        abort_if($name === '', 422, 'Please enter a folder name.');

        $ownerId = FolderProvisioner::systemOwnerId($request->user());

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'parent_id' => null,
            'owner_id' => $ownerId,
            'created_by' => $request->user()->id,
            'org_wide' => $data['audience'] === 'all_staff',
            'audience' => $data['audience'] === 'all_staff' ? 'all_staff' : null,
            'audience_role' => $data['audience'] === 'all_staff' ? ($data['role'] ?? 'viewer') : null,
        ]);

        return response()->json(['folder' => $this->presentOrg($folder)], 201);
    }

    public function updateOrganizationFolder(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeAdmin($request);

        $folder = Folder::where('uuid', $uuid)
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->firstOrFail();

        $data = $request->validate([
            'audience' => ['sometimes', Rule::in(['all_staff', 'selected'])],
            'role' => ['sometimes', Rule::in(['viewer', 'editor'])],
            'archived' => ['sometimes', 'boolean'],
        ]);

        if (isset($data['audience'])) {
            $allStaff = $data['audience'] === 'all_staff';
            $folder->org_wide = $allStaff;
            $folder->audience = $allStaff ? 'all_staff' : null;
            $folder->audience_role = $allStaff ? ($data['role'] ?? $folder->audience_role ?? 'viewer') : null;
        } elseif (isset($data['role']) && $folder->audience === 'all_staff') {
            $folder->audience_role = $data['role'];
        }

        if (array_key_exists('archived', $data)) {
            $folder->is_archived = $data['archived'];
        }

        $folder->save();

        return response()->json(['folder' => $this->presentOrg($folder)]);
    }

    /** @return array<int, array<string, mixed>> */
    private function organizationFolders(): array
    {
        return Folder::where('folder_type', Folder::TYPE_ORGANIZATION)
            ->orderBy('name')
            ->get()
            ->map(fn (Folder $f) => $this->presentOrg($f))
            ->all();
    }

    /** @return array<string, mixed> */
    private function presentOrg(Folder $folder): array
    {
        return [
            'id' => $folder->uuid,
            'name' => $folder->name,
            'audience' => $folder->audience === 'all_staff' ? 'all_staff' : 'selected',
            'role' => $folder->audience_role,
            'archived' => $folder->is_archived,
        ];
    }

    private function authorizeAdmin(Request $request): void
    {
        abort_unless(
            $request->user()?->account_type === 'Administrator',
            403,
            'Only administrators can manage the File Library configuration.'
        );
    }
}
