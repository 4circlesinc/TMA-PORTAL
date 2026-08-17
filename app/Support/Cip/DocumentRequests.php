<?php

namespace App\Support\Cip;

use App\Models\CipDocument;
use App\Models\FileItem;
use App\Models\FileRequest;
use App\Models\FileRequestUpload;
use App\Models\User;
use App\Support\Files\FileRequests;
use App\Support\Files\Versions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A direct upload link aimed at ONE checklist slot (§11).
 *
 * The tokenised public flow already exists and already handles the hard parts
 * — expiry, passwords, extension allow-lists, sniffed MIME, uploader identity.
 * What it could not do was land in a *requirement*: it targets a folder and
 * always creates a new file, so a second upload against the same document
 * arrived as "Passport bio page (2).pdf" beside the first rather than as its
 * next version, and the slot never noticed either.
 *
 * So a request may now carry a document. When it does, this decides what
 * happens to the bytes, and the two rules that matter are:
 *
 *  - the upload becomes the slot's next VERSION, through {@see Versions}. The
 *    library's own name-conflict "replace" path soft-deletes and recreates,
 *    which silently forks the chain — it is not used here and must not be.
 *  - the slot moves through {@see DocumentEngine} like every other transition,
 *    never by writing the column, so a link upload lands in the audit trail
 *    beside the ones a signed-in reviewer made.
 *
 * One link, one slot, one answer: a document link takes a single file, because
 * a requirement has one answer and a second file through the same link would
 * be a fork of the chain wearing a different hat.
 */
class DocumentRequests
{
    /**
     * Mint a link that fills one slot.
     *
     * Aimed at the person's own folder, so anything that does arrive is filed
     * where the rest of their documents are even if the slot link is later
     * broken by a purge.
     *
     * @param  array<string, mixed>  $options  passed through to FileRequests::create
     */
    public static function for(CipDocument $slot, User $creator, array $options = []): FileRequest
    {
        $slot->loadMissing(['person', 'application.client']);

        $request = new FileRequest(array_merge([
            'uuid' => (string) Str::uuid(),
            'token' => FileRequests::token(),
            'title' => $slot->label,
            'message' => 'Please upload '.$slot->label.' for '
                .($slot->person?->fullName() ?? 'this application').'.',
            // The same drawer a portal upload would use — a document must
            // not land in two places depending on which door it came in by.
            'folder_id' => DocumentSlots::destinationForSlot($slot, $creator),
            'client_id' => $slot->application?->client_id,
            'created_by' => $creator->id,
            // A requirement has one answer. See the note at the top.
            'max_files' => 1,
            'allow_multiple' => false,
        ], $options));

        FileRequests::setPassword($request, $options['password'] ?? null);
        $request->document_id = $slot->id;
        $request->save();

        return $request;
    }

    /** Is this link aimed at a checklist slot rather than a folder? */
    public static function slotFor(FileRequest $request): ?CipDocument
    {
        return $request->document_id
            ? CipDocument::find($request->document_id)
            : null;
    }

    /**
     * Put an uploaded file into the slot, as a new version where there is
     * already one.
     *
     * Returns the file the visitor's bytes ended up in — the same FileItem as
     * last time when this is a re-upload, which is the whole point.
     *
     * @param  array{uuid:string,disk:string,path:string,size:int,checksum:string}  $stored
     * @param  array{extension:string,mime:string}  $meta
     */
    public static function land(
        CipDocument $slot,
        FileRequest $request,
        array $stored,
        array $meta,
        string $name,
        ?string $uploaderName = null,
        ?string $uploaderEmail = null,
        ?string $ip = null,
    ): FileItem {
        $ownerId = (int) $request->created_by;
        $owner = User::findOrFail($ownerId);

        $file = DB::transaction(function () use (
            $slot, $request, $stored, $meta, $name, $ownerId, $owner, $uploaderName, $uploaderEmail, $ip
        ) {
            $existing = $slot->file;

            if ($existing) {
                /*
                 * The next version of the file already in the slot.
                 *
                 * addStored appends to the chain the library's own history,
                 * download and restore routes already read, so a document
                 * filled by a link has the same history as one filled by a
                 * member of staff — which is what makes "who sent this, and
                 * when" answerable later.
                 *
                 * Authored by the requester rather than by nobody: there is no
                 * account behind a token, the chain belongs to whoever asked
                 * for the file, and the visitor is named in the note, which is
                 * the only place that truth can live.
                 */
                Versions::addStored($existing, $owner, $stored, $meta, self::note($uploaderName));
                $file = $existing;
            } else {
                $file = FileItem::create([
                    'uuid' => $stored['uuid'],
                    'folder_id' => DocumentSlots::destinationForSlot($slot, $owner),
                    'name' => $name,
                    'extension' => $meta['extension'],
                    'mime_type' => $meta['mime'],
                    'size' => $stored['size'],
                    'disk' => $stored['disk'],
                    'storage_path' => $stored['path'],
                    'checksum' => $stored['checksum'],
                    // Owned by the requester, not by the visitor: there is no
                    // account behind a token, and an ownerless file is
                    // invisible to every access rule in the library.
                    'owner_id' => $ownerId,
                    'uploaded_by' => $ownerId,
                ]);

                Versions::recordInitial($file, $ownerId, self::note($uploaderName));
            }

            $slot->forceFill([
                'file_id' => $file->id,
                'uploaded_by' => null,
                'uploaded_at' => now(),
            ])->save();

            FileRequestUpload::create([
                'file_request_id' => $request->id,
                'file_id' => $file->id,
                'name' => $file->name,
                'size' => $stored['size'],
                'uploader_name' => $uploaderName,
                'uploader_email' => $uploaderEmail,
                'ip' => $ip,
            ]);

            $request->forceFill([
                'upload_count' => $request->upload_count + 1,
                'last_upload_at' => now(),
            ])->save();

            return $file;
        });

        /*
         * The status moves last, and outside the write.
         *
         * A null actor is the system, which the engine allows: nobody is
         * signed in behind a token, and refusing the transition would leave a
         * filled slot still reading "Pending upload" — a checklist lying about
         * work somebody has actually done.
         */
        self::advance($slot->refresh());

        return $file;
    }

    /** Pending upload, or a document sent back — either way an upload puts it
        in front of a reviewer again. Anything else is left as it is. */
    private static function advance(CipDocument $slot): void
    {
        $from = $slot->status ?? DocumentStatus::PENDING_UPLOAD;

        if (! in_array($from, [DocumentStatus::PENDING_UPLOAD, DocumentStatus::UPDATE_REQUIRED], true)) {
            return;
        }

        DocumentEngine::apply($slot, DocumentStatus::APPLICATION_REVIEW, null, ['reason' => 'link_upload']);
    }

    private static function note(?string $uploaderName): string
    {
        $who = trim((string) $uploaderName);

        return $who === '' ? 'Uploaded through a request link' : 'Uploaded by '.$who.' through a request link';
    }
}
