<?php

namespace App\Http\Controllers\Files;

use App\Http\Controllers\Controller;
use App\Models\FileItem;
use App\Models\FileRequest;
use App\Models\FileRequestUpload;
use App\Models\Folder;
use App\Support\Cip\DocumentRequests;
use App\Support\Cip\Package;
use App\Support\Files\Activity;
use App\Support\Files\FileRequests;
use App\Support\Files\FileType;
use App\Support\Files\FileValidationException;
use App\Support\Files\Naming;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The secure upload link, from the outside (no login).
 *
 * Everything is keyed off the token in the URL and nothing else. The visitor
 * cannot name a folder, cannot read one, cannot list what has already been
 * uploaded, and cannot reach any file, including their own. The only write
 * this route performs is "add these bytes to the destination the requester
 * chose", and every limit is re-read from the record on each upload rather
 * than trusted from the form.
 *
 * Transport is HTTPS end to end and the bytes land in the same vault as any
 * other upload, object storage in production, addressed by random uuid, never
 * by a path a visitor could guess.
 */
class PublicUploadController extends Controller
{
    public function show(Request $request, string $token)
    {
        $fileRequest = $this->find($token);

        if (! $fileRequest) {
            return response()->view('request.expired', ['reason' => 'missing'], 404);
        }

        if (! $fileRequest->isOpen() || Package::refusesRequest($fileRequest)) {
            return response()->view('request.expired', [
                'reason' => $fileRequest->closedReason() ?? 'revoked',
            ], 410);
        }

        if ($fileRequest->password_hash && ! $this->unlocked($request, $token)) {
            return response()->view('request.password', ['token' => $token, 'error' => false]);
        }

        // First open is worth knowing: "sent but never opened" and "opened and
        // ignored" are different conversations to have with a client.
        if ($fileRequest->opened_at === null) {
            $fileRequest->forceFill(['opened_at' => now()])->save();
        }

        return response()->view('request.upload', $this->pageData($fileRequest, $token));
    }

    public function unlock(Request $request, string $token)
    {
        $fileRequest = $this->find($token);

        if (! $fileRequest || ! $fileRequest->isOpen() || Package::refusesRequest($fileRequest)) {
            return response()->view('request.expired', ['reason' => $fileRequest?->closedReason() ?? 'missing'], 410);
        }

        if (! FileRequests::verifyPassword($fileRequest, $request->input('password'))) {
            return response()->view('request.password', ['token' => $token, 'error' => true], 422);
        }

        $request->session()->put('upload_unlocked.'.$token, true);

        return redirect('/r/'.$token);
    }

    /**
     * Receive one file.
     *
     * One file per request on purpose: a browser sending ten at once and
     * failing on the ninth would otherwise leave the visitor with no idea
     * which arrived. The page posts them in sequence and reports each.
     */
    public function upload(Request $request, string $token): JsonResponse
    {
        $fileRequest = $this->find($token);

        abort_unless($fileRequest, 404, 'This upload link no longer exists.');
        abort_unless($fileRequest->isOpen() && ! Package::refusesRequest($fileRequest), 410, $this->closedMessage($fileRequest));
        abort_if(
            $fileRequest->password_hash && ! $this->unlocked($request, $token),
            403,
            'Enter the password before uploading.'
        );

        $request->validate([
            'file' => ['required', 'file', 'max:'.(int) (FileRequests::maxBytes($fileRequest) / 1024)],
            'name' => ['nullable', 'string', 'max:120'],
            'email' => ['nullable', 'email', 'max:191'],
        ]);

        // Re-read rather than trust the form: the requester may have closed or
        // narrowed the link since the page was loaded.
        abort_if($fileRequest->isFull(), 422, 'This request has already received all the files it accepts.');

        $upload = $request->file('file');
        $original = (string) $upload->getClientOriginalName();

        if ($reason = FileRequests::rejectExtension($fileRequest, $original)) {
            return response()->json(['message' => $reason], 422);
        }

        try {
            // The same inspection every signed-in upload gets: extension AND
            // sniffed MIME, so a renamed executable is refused even when the
            // requester allowed "any file type".
            $meta = FileType::inspect($upload->getRealPath(), $original);
        } catch (FileValidationException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $folder = $fileRequest->folder_id ? Folder::find($fileRequest->folder_id) : null;
        abort_if($fileRequest->folder_id && ! $folder, 410, 'The destination folder no longer exists.');

        $ownerId = (int) $fileRequest->created_by;
        $name = Naming::nextAvailable(
            Naming::assertValid($original),
            fn ($candidate) => FileItem::query()
                ->where('folder_id', $folder?->id)
                ->when($folder === null, fn ($q) => $q->where('owner_id', $ownerId))
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                ->exists(),
        );

        $stored = Vault::store($upload->getRealPath(), $meta['extension']);

        /*
         * A link aimed at a checklist slot lands differently (§11).
         *
         * The ordinary path below makes a NEW file every time, which is right
         * for "send me your invoices" and wrong for "send me your police
         * certificate": a requirement has one answer, and a second upload is
         * the next version of it, not a second document beside the first.
         * DocumentRequests owns that difference, including moving the slot on
         * through the engine.
         */
        if ($slot = DocumentRequests::slotFor($fileRequest)) {
            $file = DocumentRequests::land(
                $slot,
                $fileRequest,
                $stored,
                $meta,
                $name,
                $request->input('name'),
                $request->input('email'),
                $request->ip(),
            );

            Activity::forFile($ownerId, $file, 'upload', [
                'size' => $file->size,
                'via' => 'request',
                'request' => $fileRequest->uuid,
                'document' => $slot->uuid,
            ]);

            $this->notifyRequester($fileRequest, $file, (string) $request->input('name', ''));

            // The same shape the ordinary path answers with, the upload page
            // reads it and does not care which door the file went through.
            return response()->json([
                'name' => $file->name,
                'size' => (int) $file->size,
                'remaining' => $fileRequest->fresh()->remainingUploads(),
            ], 201);
        }

        $file = DB::transaction(function () use ($fileRequest, $folder, $ownerId, $name, $meta, $stored, $request) {
            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $folder?->id,
                'name' => $name,
                'extension' => $meta['extension'],
                'mime_type' => $meta['mime'],
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                // The requester owns what arrives, there is no account behind
                // the visitor to own it, and an ownerless file would be
                // invisible to every access rule in the library.
                'owner_id' => $ownerId,
                'uploaded_by' => $ownerId,
            ]);

            FileRequestUpload::create([
                'file_request_id' => $fileRequest->id,
                'file_id' => $file->id,
                'name' => $name,
                'size' => $stored['size'],
                'uploader_name' => $request->input('name'),
                'uploader_email' => $request->input('email'),
                'ip' => $request->ip(),
            ]);

            $fileRequest->forceFill([
                'upload_count' => $fileRequest->upload_count + 1,
                'last_upload_at' => now(),
            ])->save();

            return $file;
        });

        Versions::recordInitial($file, $ownerId);
        Activity::forFile($ownerId, $file, 'upload', [
            'size' => $file->size,
            'via' => 'request',
            'request' => $fileRequest->uuid,
        ]);

        $this->notifyRequester($fileRequest, $file, (string) $request->input('name', ''));

        // No explicit broadcast here: FileLibraryObserver already turns the
        // FileItem::create above into a `files` signal, so a requester with the
        // Dashboard or the library open sees the file arrive on its own.

        return response()->json([
            'name' => $file->name,
            'size' => (int) $file->size,
            'remaining' => $fileRequest->fresh()->remainingUploads(),
        ], 201);
    }

    /* ── internals ─────────────────────────────────── */

    private function find(string $token): ?FileRequest
    {
        return FileRequest::with(['creator:id,name,email,first_name', 'folder:id,uuid,name'])
            ->where('token', $token)
            ->first();
    }

    private function unlocked(Request $request, string $token): bool
    {
        return (bool) $request->session()->get('upload_unlocked.'.$token);
    }

    private function closedMessage(FileRequest $fileRequest): string
    {
        if (Package::refusesRequest($fileRequest)) {
            return 'This upload link has been withdrawn.';
        }

        return match ($fileRequest->closedReason()) {
            'expired' => 'This upload link has expired.',
            'revoked' => 'This upload link has been withdrawn.',
            default => 'This request is no longer accepting files.',
        };
    }

    /** @return array<string, mixed> */
    private function pageData(FileRequest $fileRequest, string $token): array
    {
        $allowed = is_array($fileRequest->allowed_extensions) ? $fileRequest->allowed_extensions : [];

        return [
            'request' => $fileRequest,
            'token' => $token,
            'requester' => $fileRequest->creator?->name ?? Postcards::site(),
            'destination' => $fileRequest->folder?->name ?? 'the secure File Box',
            'allowed' => $allowed,
            // `accept` for the file picker; the server still re-checks.
            'accept' => $allowed === [] ? '' : implode(',', array_map(fn ($e) => '.'.$e, $allowed)),
            'allowedLabel' => $allowed === [] ? null : FileRequests::describeExtensions($allowed),
            'maxBytes' => FileRequests::maxBytes($fileRequest),
            'maxFiles' => (int) $fileRequest->max_files,
            'remaining' => $fileRequest->remainingUploads(),
            'multiple' => (bool) $fileRequest->allow_multiple,
        ];
    }

    /**
     * Tell the requester something arrived.
     *
     * In the portal always; by email only when they asked to hear about file
     * activity. Both are best-effort, a notification that fails must not undo
     * an upload that already succeeded, because the bytes are safely stored and
     * telling the visitor otherwise would have them send it again.
     */
    private function notifyRequester(FileRequest $fileRequest, FileItem $file, string $from): void
    {
        $creator = $fileRequest->creator;

        if (! $creator) {
            return;
        }

        $url = '/folders'.($fileRequest->folder ? '?folder='.$fileRequest->folder->uuid : '');
        $who = $from !== '' ? $from : ($fileRequest->recipient_name ?: 'Someone');

        Notifier::send([
            'user' => $creator,
            'type' => 'file.uploaded',
            'title' => $who.' uploaded '.$file->name,
            'message' => 'Received through your request “'.$fileRequest->title.'”.',
            'subject' => $file,
            'client' => $fileRequest->client_id,
            'action_url' => $url,
            // A client dropping twelve files should be one line in the bell,
            // not twelve. The window is long enough to cover one sitting.
            'dedupe_key' => 'file-request:'.$fileRequest->uuid,
            'dedupe_minutes' => 30,
        ]);

        // Email only for the first arrival. The notification above already
        // covers the rest, and a client uploading a dozen documents should not
        // produce a dozen emails.
        if ((int) $fileRequest->upload_count !== 1) {
            return;
        }

        try {
            Deliveries::send(
                Postcards::fileRequestReceived(
                    $fileRequest->title,
                    1,
                    $from !== '' ? $from : null,
                    url($url),
                    $creator->first_name ?: null,
                ),
                $creator->email,
                $fileRequest,
                'fileRequestReceived',
                immediate: true,
            );
        } catch (\Throwable) {
            // Best effort, see above.
        }
    }
}
