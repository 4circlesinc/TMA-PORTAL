<?php

namespace App\Http\Controllers;

use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Support\Access\Role;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\FolderTemplates;
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
            'name' => ['sometimes', 'string', 'max:255'],
            'audience' => ['sometimes', Rule::in(['all_staff', 'selected'])],
            'role' => ['sometimes', Rule::in(['viewer', 'editor'])],
            'archived' => ['sometimes', 'boolean'],
        ]);

        if (isset($data['name'])) {
            $name = Naming::clean($data['name']);
            abort_if($name === '', 422, 'Please enter a folder name.');
            $folder->name = $name;
        }

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

    /**
     * Turn an existing top-level folder into an organization (default) folder,
     * so it appears automatically in every staff member's Folder Shortcuts.
     */
    public function adoptFolder(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'folder' => ['required', 'string'],
            'audience' => ['sometimes', Rule::in(['all_staff', 'selected'])],
            'role' => ['sometimes', Rule::in(['viewer', 'editor'])],
        ]);

        $folder = Folder::where('uuid', $data['folder'])->firstOrFail();

        abort_unless($folder->parent_id === null, 422, 'Only a top-level folder can be made a default folder.');
        abort_if(
            in_array($folder->folder_type, [Folder::TYPE_CLIENT, Folder::TYPE_STAFF, Folder::TYPE_ROOT], true),
            422,
            'Client, staff and system folders can’t be made organization folders.'
        );

        $allStaff = ($data['audience'] ?? 'all_staff') === 'all_staff';
        $folder->folder_type = Folder::TYPE_ORGANIZATION;
        $folder->org_wide = $allStaff;
        $folder->audience = $allStaff ? 'all_staff' : null;
        $folder->audience_role = $allStaff ? ($data['role'] ?? 'viewer') : null;
        $folder->is_archived = false;
        $folder->save();

        return response()->json(['folder' => $this->presentOrg($folder)]);
    }

    /* ── Folder templates ─────────────────────────────────────────────
       A template is a named set of subfolder names and nothing else. All the
       interest is in applyTemplate(), which is what stops this being another
       list that saves and does nothing. */

    public function templates(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        return response()->json([
            'templates' => FolderTemplates::all(),
            // Where a template can be applied. Organization folders and client
            // folders are the two places a firm actually files things; a
            // template dropped into somebody's personal folder is not what the
            // screen is for.
            'targets' => $this->templateTargets(),
            'maxSubfolders' => FolderTemplates::MAX_SUBFOLDERS,
        ]);
    }

    public function storeTemplate(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $this->templateRules($request);

        abort_if(
            count(FolderTemplates::all()) >= FolderTemplates::MAX_TEMPLATES,
            422,
            'You already have '.FolderTemplates::MAX_TEMPLATES.' folder templates. Delete one first.'
        );

        $template = FolderTemplates::create($data['name'], $data['subfolders']);

        abort_if($template['name'] === '', 422, 'Please enter a template name.');

        return response()->json(['template' => $template, 'templates' => FolderTemplates::all()], 201);
    }

    public function updateTemplate(Request $request, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $this->templateRules($request);

        $template = FolderTemplates::update($id, $data['name'], $data['subfolders']);

        abort_if($template === null, 404, 'That folder template no longer exists.');
        abort_if($template['name'] === '', 422, 'Please enter a template name.');

        return response()->json(['template' => $template, 'templates' => FolderTemplates::all()]);
    }

    public function destroyTemplate(Request $request, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        abort_unless(FolderTemplates::delete($id), 404, 'That folder template no longer exists.');

        // Deleting a template never touches folders it created. They are
        // ordinary folders the moment they exist — the template is a shortcut,
        // not an owner, and deleting one must not delete a firm's filing.
        return response()->json(['templates' => FolderTemplates::all()]);
    }

    /** Create a template's subfolders inside a folder. */
    public function applyTemplate(Request $request, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate(['folder' => ['required', 'string']]);

        $template = FolderTemplates::find($id);
        abort_if($template === null, 404, 'That folder template no longer exists.');

        $folder = Folder::where('uuid', $data['folder'])->firstOrFail();

        // `files.settings` says who may manage templates; it does not say who
        // may write into a given folder. That is FileAccess's question, and it
        // is asked separately so a template can never become a way around a
        // folder's own permissions.
        FileAccess::authorize($request->user(), 'upload', $folder);

        $created = FolderTemplates::apply($template, $folder);

        return response()->json([
            'created' => $created,
            // Names that were already there. Worth returning rather than
            // silently reporting success: "applied, nothing to do" and
            // "applied, made five folders" are different outcomes.
            'skipped' => array_values(array_diff($template['subfolders'], $created)),
            'folder' => ['id' => $folder->uuid, 'name' => $folder->name],
        ]);
    }

    /** @return array{name: string, subfolders: array<int, string>} */
    private function templateRules(Request $request): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'subfolders' => ['required', 'array', 'min:1', 'max:'.FolderTemplates::MAX_SUBFOLDERS],
            'subfolders.*' => ['nullable', 'string', 'max:255'],
        ]);

        return ['name' => $data['name'], 'subfolders' => $data['subfolders']];
    }

    /**
     * Folders a template may be applied to: the firm's shared internal
     * folders and each client's folder.
     *
     * @return array<int, array<string, mixed>>
     */
    private function templateTargets(): array
    {
        return Folder::whereIn('folder_type', [Folder::TYPE_ORGANIZATION, Folder::TYPE_CLIENT])
            ->where('is_archived', false)
            ->orderBy('folder_type')
            ->orderBy('name')
            ->get()
            ->map(fn (Folder $f) => [
                'id' => $f->uuid,
                'name' => $f->name,
                'group' => $f->folder_type === Folder::TYPE_ORGANIZATION ? 'Organization folders' : 'Client folders',
            ])
            ->all();
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
            Role::can($request->user(), 'files.settings'),
            403,
            'Only administrators can manage the File Library configuration.'
        );
    }
}
