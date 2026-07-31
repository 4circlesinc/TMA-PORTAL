<?php

namespace App\Http\Controllers\Files;

use App\Jobs\GenerateFileThumbnail;
use App\Models\UploadSession;
use App\Support\Files\ChunkedUpload;
use App\Support\Files\FileAccess;
use App\Support\Files\Versions;
use App\Support\Files\Thumbnail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Resumable chunked upload endpoints. init → chunk (repeated) → complete.
 * A FileItem only exists after complete() assembles and validates every chunk.
 */
class UploadController extends BaseFilesController
{
    public function init(Request $request): JsonResponse
    {
        $request->validate([
            'filename' => ['required', 'string', 'max:255'],
            'size' => ['required', 'integer', 'min:0'],
            'folder' => ['nullable', 'string'],
            'chunkSize' => ['nullable', 'integer', 'min:1'],
            'mime' => ['nullable', 'string', 'max:191'],
            // Set to make this upload a new VERSION of an existing file rather
            // than a new file — the only route large files have to a version.
            'versionOf' => ['nullable', 'string', 'max:64'],
            'versionNote' => ['nullable', 'string', 'max:2000'],
        ]);

        $user = $this->user($request);

        $versionOf = null;
        if ($request->filled('versionOf')) {
            $versionOf = $this->findFile($request->input('versionOf'));
            abort_unless(Versions::canAddVersion($user, $versionOf), 403, 'You can’t add a version to that file.');
        }

        // A version upload inherits its target's folder; only a new file needs
        // an upload-permission check on a destination.
        $folder = $versionOf ? null : $this->resolveTarget($request, 'folder');
        if (! $versionOf) {
            abort_unless(FileAccess::canUploadTo($user, $folder), 403, 'Permission denied.');
        }

        $session = ChunkedUpload::init(
            $user,
            $request->input('filename'),
            (int) $request->input('size'),
            $folder,
            (int) $request->input('chunkSize', 0),
            $request->input('mime'),
            $versionOf,
            $request->input('versionNote'),
        );

        return response()->json([
            'id' => $session->uuid,
            'chunkSize' => $session->chunk_size,
            'totalChunks' => $session->total_chunks,
            'received' => [],
            'status' => $session->status,
        ], 201);
    }

    public function chunk(Request $request, string $uuid): JsonResponse
    {
        $request->validate([
            'index' => ['required', 'integer', 'min:0'],
            'chunk' => ['required', 'file'],
        ]);

        $session = $this->session($request, $uuid);

        $session = ChunkedUpload::receiveChunk(
            $session,
            (int) $request->input('index'),
            $request->file('chunk')->getRealPath(),
        );

        return response()->json([
            'id' => $session->uuid,
            'received' => ChunkedUpload::receivedIndexes($session),
            'receivedCount' => $session->received_count,
            'totalChunks' => $session->total_chunks,
            'status' => $session->status,
        ]);
    }

    public function status(Request $request, string $uuid): JsonResponse
    {
        $session = $this->session($request, $uuid);

        return response()->json([
            'id' => $session->uuid,
            'received' => ChunkedUpload::receivedIndexes($session),
            'receivedCount' => $session->received_count,
            'totalChunks' => $session->total_chunks,
            'status' => $session->status,
        ]);
    }

    public function complete(Request $request, string $uuid): JsonResponse
    {
        $request->validate([
            'conflict' => ['nullable', 'in:replace,keep-both,rename'],
            'newName' => ['nullable', 'string', 'max:255'],
        ]);

        $session = $this->session($request, $uuid);

        $file = ChunkedUpload::complete(
            $session,
            $request->input('conflict'),
            $request->input('newName'),
        );

        /*
         * Build the thumbnail in the background rather than on the first
         * request that happens to need it. The upload response does not wait on
         * it, and by the time the file shows up in a listing the image is
         * usually already there. ThumbnailController still generates on demand
         * for anything this misses.
         */
        if (Thumbnail::supportsExt($file->extension)) {
            GenerateFileThumbnail::dispatch($file->id)->afterResponse();
        }

        return response()->json($this->presenter($request)->file($file), 201);
    }

    public function abort(Request $request, string $uuid): JsonResponse
    {
        $session = $this->session($request, $uuid);
        ChunkedUpload::abort($session);

        return response()->json(['ok' => true]);
    }

    /** Load the caller's own upload session or 404/403. */
    private function session(Request $request, string $uuid): UploadSession
    {
        $session = UploadSession::where('uuid', $uuid)->first();
        abort_unless($session, 404, 'Upload session no longer exists.');
        abort_unless(
            $session->user_id === $this->user($request)->id || FileAccess::isAdmin($this->user($request)),
            403,
            'Permission denied.'
        );

        return $session;
    }
}
