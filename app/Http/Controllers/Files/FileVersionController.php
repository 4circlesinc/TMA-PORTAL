<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Support\Files\FileAccess;
use App\Support\Files\FileType;
use App\Support\Files\Presenter;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Version history for a file.
 *
 * Nothing here deletes stored bytes. Uploading a version appends; restoring
 * appends. That is the whole safety property of this feature, and it is a
 * property of the routes as much as of the service.
 */
class FileVersionController extends BaseFilesController
{
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $versions = Versions::history($file);
        $canDownload = FileAccess::can($user, 'download', $file);
        $canPreview = FileAccess::can($user, 'preview', $file);
        $canRestore = Versions::canRestore($user, $file);

        return response()->json([
            'canAddVersion' => Versions::canAddVersion($user, $file),
            'current' => $versions->firstWhere('is_current', true)?->version_number,
            'versions' => $versions->map(fn (FileVersion $v) => [
                'id' => $v->uuid,
                'number' => $v->version_number,
                'isCurrent' => (bool) $v->is_current,
                'size' => (int) $v->size,
                'sizeLabel' => Presenter::humanSize((int) $v->size),
                'mime' => $v->mime_type,
                // Short hash: enough to tell two versions apart by eye, without
                // implying it is something to copy around.
                'checksum' => $v->checksum ? substr($v->checksum, 0, 12) : null,
                'note' => $v->note,
                'restoredFrom' => $v->restoredFrom?->version_number,
                'approvalStatus' => $v->approval_status,
                'uploadedAt' => optional($v->created_at)->toIso8601String(),
                'uploadedBy' => $v->uploader ? [
                    'name' => $v->uploader->name,
                    'email' => $v->uploader->email,
                    'avatar' => $v->uploader->photoUrl(),
                ] : null,
                'can' => [
                    // The current version is downloaded/previewed through the
                    // file's own routes; only older ones need these.
                    'download' => $canDownload,
                    'preview' => $canPreview && FileType::isPreviewable((string) $v->extension),
                    'restore' => $canRestore && ! $v->is_current,
                ],
            ])->values(),
        ]);
    }

    /**
     * Upload a new version directly (small files). Large ones go through the
     * chunked session with `versionOf`, which lands in the same service.
     */
    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);

        abort_unless(Versions::canAddVersion($user, $file), 403, 'You can’t add a version to this file.');

        $request->validate([
            'file' => ['required', 'file', 'max:'.(int) (FileType::MAX_BYTES / 1024)],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $upload = $request->file('file');
        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());

        $stored = Vault::store($upload->getRealPath(), $meta['extension']);
        $version = Versions::addStored($file, $user, $stored, $meta, $request->input('note'));

        return response()->json([
            'version' => $version->version_number,
            'file' => $this->presenter($request)->file($file->fresh()),
        ], 201);
    }

    /** Amend the note on a version. The bytes are immutable; the reason is not. */
    public function update(Request $request, string $uuid, string $versionUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $version = $this->findVersion($file, $versionUuid);

        abort_unless(Versions::canAddVersion($user, $file), 403, 'You can’t edit this version.');

        $data = $request->validate(['note' => ['nullable', 'string', 'max:2000']]);
        $version->update(['note' => $data['note'] ?? null]);

        return response()->json(['status' => 'ok', 'note' => $version->note]);
    }

    public function download(Request $request, string $uuid, string $versionUuid): StreamedResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'download', $file);

        $version = $this->findVersion($file, $versionUuid);
        \App\Support\Files\Activity::forFile($user->id, $file, 'download', [
            'version' => $version->version_number,
        ]);

        return Vault::downloadVersion($version, $this->versionName($file, $version));
    }

    public function preview(Request $request, string $uuid, string $versionUuid): StreamedResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'preview', $file);

        $version = $this->findVersion($file, $versionUuid);
        abort_unless(FileType::isPreviewable((string) $version->extension), 415, 'This version can’t be previewed.');

        return Vault::previewVersion($version, $this->versionName($file, $version));
    }

    /**
     * Make an older version current again — by appending a new version, never
     * by removing the ones that came after it.
     */
    public function restore(Request $request, string $uuid, string $versionUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $version = $this->findVersion($file, $versionUuid);

        abort_unless(Versions::canRestore($user, $file), 403, 'You can’t restore a version of this file.');
        abort_if($version->is_current, 422, 'That version is already the current one.');

        $data = $request->validate(['note' => ['nullable', 'string', 'max:2000']]);
        $new = Versions::restore($file, $version, $user, $data['note'] ?? null);

        return response()->json([
            'version' => $new->version_number,
            'restoredFrom' => $version->version_number,
            'file' => $this->presenter($request)->file($file->fresh()),
        ]);
    }

    /** "Contract.pdf" at v3 downloads as "Contract (v3).pdf", never overwriting. */
    private function versionName(FileItem $file, FileVersion $version): string
    {
        $ext = $file->extension ? '.'.$file->extension : '';
        $base = $ext && str_ends_with($file->name, $ext)
            ? substr($file->name, 0, -strlen($ext))
            : $file->name;

        return $base.' (v'.$version->version_number.')'.$ext;
    }

    private function findVersion(FileItem $file, string $versionUuid): FileVersion
    {
        $version = FileVersion::where('file_id', $file->id)->where('uuid', $versionUuid)->first();

        abort_unless($version, 404, 'That version no longer exists.');

        return $version;
    }
}
