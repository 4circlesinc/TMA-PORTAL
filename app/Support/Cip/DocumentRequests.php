<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\FileItem;
use App\Models\FileRequest;
use App\Models\FileRequestUpload;
use App\Models\User;
use App\Support\Files\FileRequests;
use App\Support\Files\Naming;
use App\Support\Files\Versions;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Str;

/**
 * A direct upload link aimed at ONE checklist slot (section 11).
 *
 * The tokenised public flow already exists and already handles the hard parts
 *, expiry, passwords, extension allow-lists, sniffed MIME, uploader identity.
 * What it could not do was land in a *requirement*: it targets a folder and
 * always creates a new file, so a second upload against the same document
 * arrived as "Passport bio page (2).pdf" beside the first rather than as its
 * next version, and the slot never noticed either.
 *
 * So a request may now carry a document. When it does, this decides what
 * happens to the bytes, and the two rules that matter are:
 *
 *  - the upload becomes the slot's next VERSION, through {@see Versions}.
 *    The library's same-name "Replace existing" path now does the same,
 *    so a replacement never forks onto a second FileItem.
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
        Confirmation::guardDocument($slot);

        $request = new FileRequest(array_merge([
            'uuid' => (string) Str::uuid(),
            'token' => FileRequests::token(),
            'title' => $slot->label,
            'message' => 'Please upload '.$slot->label.' for '
                .($slot->person?->fullName() ?? 'this application').'.',
            // The same drawer a portal upload would use, a document must
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

    /**
     * One link that asks for several checklist documents at once.
     *
     * Asking a service provider for an Oath of Allegiance, a proof of payment
     * and a passport photo used to be three links. Now it is one request
     * listing the three; the upload page shows each as its own row, and each
     * file lands in its own slot under that slot's filed name, exactly as if
     * staff had uploaded it.
     *
     * @param  iterable<CipDocument>  $slots
     * @param  array<string, mixed>  $options  title, message, recipient_*, allowed_extensions, max_bytes, expires_at, password
     */
    public static function forMany(CipApplication $application, iterable $slots, User $creator, array $options = []): FileRequest
    {
        $slots = collect($slots)->unique('id')->values();

        if ($slots->isEmpty()) {
            throw ValidationException::withMessages(['documents' => 'Choose at least one document to ask for.']);
        }

        foreach ($slots as $slot) {
            if ((int) $slot->application_id !== (int) $application->id) {
                throw ValidationException::withMessages(['documents' => 'Every document must belong to this application.']);
            }
            // The original package is frozen once confirmed: a request for a
            // paper inside it would only be refused when it arrived.
            Confirmation::guardDocument($slot);
        }

        $application->loadMissing('client');
        $labels = $slots->map(fn (CipDocument $slot) => DocumentTypes::present((string) $slot->label))->all();
        $who = $application->client?->name ?: $application->displayNumber();

        return DB::transaction(function () use ($application, $slots, $creator, $options, $labels, $who) {
            $request = new FileRequest(array_merge([
                'uuid' => (string) Str::uuid(),
                'token' => FileRequests::token(),
                'title' => count($labels) === 1
                    ? $labels[0].' for '.$who
                    : 'Documents for '.$who,
                'message' => 'Please upload '.self::listed($labels).' for '.$who.'.',
                // Shown as where the files go; each one still lands in its
                // own slot's folder.
                'folder_id' => $application->folder_id,
                'client_id' => $application->client_id,
                'created_by' => $creator->id,
                // One file per document asked for.
                'max_files' => $slots->count(),
                'allow_multiple' => $slots->count() > 1,
            ], array_diff_key($options, ['password' => true])));

            FileRequests::setPassword($request, $options['password'] ?? null);
            $request->save();

            $now = now();
            DB::table('file_request_documents')->insert($slots->map(fn (CipDocument $slot) => [
                'file_request_id' => $request->id,
                'document_id' => $slot->id,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());

            return $request;
        });
    }

    /**
     * The documents a request asks for, each with whether it has arrived.
     *
     * @return Collection<int, array{slot: CipDocument, received: bool, fileId: ?int}>
     */
    public static function listFor(FileRequest $request): Collection
    {
        $rows = DB::table('file_request_documents')
            ->where('file_request_id', $request->id)
            ->orderBy('id')
            ->get();

        if ($rows->isEmpty()) {
            return collect();
        }

        $slots = CipDocument::query()
            ->with('person')
            ->whereIn('id', $rows->pluck('document_id'))
            ->get()
            ->keyBy('id');

        return $rows
            ->filter(fn ($row) => $slots->has($row->document_id))
            ->map(fn ($row) => [
                'slot' => $slots->get($row->document_id),
                'received' => $row->file_id !== null,
                'fileId' => $row->file_id !== null ? (int) $row->file_id : null,
                'uploadedAt' => $row->uploaded_at,
                // Frozen since it was asked for (its package was confirmed):
                // shown, but no longer taking a file.
                'closed' => $row->file_id === null && Package::locksDocument($slots->get($row->document_id)),
            ])
            ->values();
    }

    /** Does this request carry a list of documents? */
    public static function isList(FileRequest $request): bool
    {
        return DB::table('file_request_documents')->where('file_request_id', $request->id)->exists();
    }

    /** One document of a list request, by the slot's uuid; null if it is not on the list. */
    public static function listedSlot(FileRequest $request, string $slotUuid): ?CipDocument
    {
        $slot = CipDocument::query()->where('uuid', $slotUuid)->first();

        if ($slot === null) {
            return null;
        }

        $onList = DB::table('file_request_documents')
            ->where('file_request_id', $request->id)
            ->where('document_id', $slot->id)
            ->exists();

        return $onList ? $slot : null;
    }

    /** Has this document of the list already been answered through the link? */
    public static function received(FileRequest $request, CipDocument $slot): bool
    {
        return DB::table('file_request_documents')
            ->where('file_request_id', $request->id)
            ->where('document_id', $slot->id)
            ->whereNotNull('file_id')
            ->exists();
    }

    /** @param  list<string>  $labels */
    private static function listed(array $labels): string
    {
        if (count($labels) <= 1) {
            return $labels[0] ?? 'the documents';
        }

        $last = array_pop($labels);

        return implode(', ', $labels).' and '.$last;
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
     * Returns the file the visitor's bytes ended up in, the same FileItem as
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
        $slot->loadMissing('application');
        Confirmation::guardDocument($slot);

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
                 * member of staff, which is what makes "who sent this, and
                 * when" answerable later.
                 *
                 * Authored by the requester rather than by nobody: there is no
                 * account behind a token, the chain belongs to whoever asked
                 * for the file, and the visitor is named in the note, which is
                 * the only place that truth can live.
                 */
                Versions::addStored($existing, $owner, $stored, $meta, self::note($uploaderName), null, $name);
                $file = $existing;
            } else {
                /*
                 * Filed under the slot's own name, not the visitor's: what
                 * the requester asked for was "the Oath of Allegiance", and
                 * that is what the folder should say, the same name a portal
                 * upload into the slot would be given.
                 */
                $folderId = DocumentSlots::destinationForSlot($slot, $owner);
                $filed = DocumentSlots::filedNameFor($slot, (string) $meta['extension'], $name);
                $name = Naming::nextAvailable(
                    $filed,
                    fn (string $candidate) => FileItem::query()
                        ->where('folder_id', $folderId)
                        ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                        ->exists(),
                );

                // The link names its slot; the file must not also be
                // adopted by name into a different one on the way in.
                $file = DocumentSlots::filing(fn () => FileItem::create([
                    'uuid' => $stored['uuid'],
                    'folder_id' => $folderId,
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
                ]));

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

            // A list request: this document has been answered.
            DB::table('file_request_documents')
                ->where('file_request_id', $request->id)
                ->where('document_id', $slot->id)
                ->update(['file_id' => $file->id, 'uploaded_at' => now(), 'updated_at' => now()]);

            return $file;
        });

        /*
         * The status moves last, and outside the write.
         *
         * A null actor is the system, which the engine allows: nobody is
         * signed in behind a token, and refusing the transition would leave a
         * filled slot still reading "Pending upload", a checklist lying about
         * work somebody has actually done.
         */
        self::advance($slot->refresh());

        return $file;
    }

    /** Pending upload, or a document sent back, either way an upload puts it
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
