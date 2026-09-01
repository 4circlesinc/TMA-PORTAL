<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\FileItem;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Contacts;
use App\Support\Cip\Letters;
use App\Support\Cip\Tree;
use App\Support\Documents\DocxMerge;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Mail merge against an application: a Word template with {{shortcodes}}
 * becomes a filled document filed in Additional Documents — as a PDF when
 * Microsoft Graph can convert it, as the merged .docx otherwise.
 *
 * The shortcodes are the letter placeholders ({@see Letters::placeholders}),
 * one vocabulary across letters, notices, and merges.
 */
class CipMergeController extends Controller
{
    /** The Word documents this reader could merge from. */
    public function templates(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user) && Role::isStaff($user), 404);

        $files = FileItem::query()
            ->where('extension', 'docx')
            ->whereNull('deleted_at')
            ->orderBy('name')
            ->limit(300)
            ->get()
            ->filter(fn (FileItem $file) => FileAccess::can($user, 'view', $file))
            ->take(100)
            ->map(fn (FileItem $file) => ['id' => $file->uuid, 'name' => $file->name])
            ->values();

        return response()->json([
            'templates' => $files,
            'placeholders' => Letters::placeholders(),
        ]);
    }

    /** Merge one template for one application and file the result. */
    public function generate(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user) && Role::isStaff($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'file' => ['required', 'string', 'max:64'],
        ]);

        $template = FileItem::query()
            ->where('uuid', $data['file'])
            ->where('extension', 'docx')
            ->whereNull('deleted_at')
            ->first();
        abort_unless($template && FileAccess::can($user, 'view', $template), 404, 'That template is gone.');

        $source = Vault::localCopy($template);
        abort_unless($source !== null, 422, 'Could not read that template.');

        $vars = Letters::vars($application) + ['date' => now()->format('d.m.Y')];
        $merged = DocxMerge::merge($source, $vars);

        // Word fidelity when Graph can render it; the merged Word file when
        // it cannot — filled either way, never silently unfilled.
        $pdf = DocxMerge::toPdf($merged);
        $bytes = $pdf ?? $merged;
        $ext = $pdf !== null ? 'pdf' : 'docx';
        $mime = $pdf !== null
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        $stem = preg_replace('/\.docx$/i', '', $template->name) ?: 'Document';
        $name = Contacts::facts($application)['applicant'].' – '.$stem.'.'.$ext;

        $file = DB::transaction(function () use ($application, $user, $bytes, $ext, $mime, $name) {
            $drawer = Tree::provisionAdditionalDrawers($application, $user);

            $tmp = tempnam(sys_get_temp_dir(), 'merged');
            file_put_contents($tmp, $bytes);
            $stored = Vault::store($tmp, $ext);
            @unlink($tmp);

            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $drawer->id,
                'name' => $name,
                'extension' => $ext,
                'mime_type' => $mime,
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'owner_id' => FolderProvisioner::systemOwnerId($user),
                'uploaded_by' => $user->id,
            ]);

            Versions::recordInitial($file, $user->id);

            return $file;
        });

        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json([
            'file' => ['id' => $file->uuid, 'name' => $file->name, 'extension' => $ext],
            'converted' => $pdf !== null,
        ]);
    }
}
