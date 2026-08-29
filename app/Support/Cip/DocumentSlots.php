<?php

namespace App\Support\Cip;

use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FileType;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Opening a person's document slots, and filling one.
 *
 * Bytes go through Vault and Versions like every other file in the portal —
 * never a side path. That is what makes an application's documents the same
 * objects the file library shows, with the same version history, the same
 * previews and the same permissions, rather than a parallel store that would
 * have to grow all of it again.
 *
 * Uploads are owned by the firm's service account, not the person who pressed
 * Add. `files.owner_id` cascades on delete and an owner holds irrevocable
 * rights, so a provider contact owning an application's birth certificate
 * would mean their account being closed took the document with it, and would
 * give them a claim Phase 7's submission lock could not overrule.
 */
class DocumentSlots
{
    /**
     * Every slot this person owes, created empty if it is not there yet.
     *
     * The list is no longer a fixed three per role. It comes from the
     * requirement templates the firm keeps, matched to the person's applicant
     * type, which for a dependant means their age bracket, so widening a
     * checklist is an edit in the portal rather than a deploy.
     *
     * Idempotent, and it never disturbs a slot that has been filled. See
     * {@see Requirements::materialise()} for what happens when a template
     * changes under an application already in flight.
     *
     * @return Collection<int, CipDocument>
     */
    public static function open(CipPerson $person): Collection
    {
        return Requirements::materialise($person);
    }

    /**
     * Put an uploaded file in a slot.
     *
     * A second upload against a filled slot adds a version to the file that
     * is already there rather than orphaning it: the checklist keeps one
     * answer per requirement, and the history of that answer stays with it.
     *
     * Intake may not replace a filed answer unless a reviewer sent it back —
     * that is what forces the Upload new version path in the file viewer.
     */
    public static function fill(CipPerson $person, string $type, UploadedFile $upload, User $actor): CipDocument
    {
        $person->loadMissing('application');
        Confirmation::guard($person->application);

        // Resolved once, for the slot AND the destination, the same single
        // query slotFor always ran, not a second one beside it.
        $template = self::template($person, $type);
        $slot = self::slotFor($person, $type, $template);

        if ($slot->file_id && ($slot->status ?? DocumentStatus::PENDING_UPLOAD) !== DocumentStatus::UPDATE_REQUIRED) {
            throw new \InvalidArgumentException(
                DocumentTypes::label($type).' is already filed. Upload a new version from the file viewer.',
            );
        }

        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
        $stored = Vault::store($upload->getRealPath(), $meta['extension']);

        // A name that says what it answers and who for. The uploaded filename
        // is usually "scan0001.pdf", which tells a reviewer nothing.
        $name = self::documentName($person, $type, $meta['extension']);

        return DB::transaction(function () use ($slot, $person, $template, $stored, $meta, $name, $actor) {
            if ($slot->file_id && $file = $slot->file) {
                Versions::addStored($file, $actor, $stored, $meta);
                $slot->forceFill(['uploaded_by' => $actor->id, 'uploaded_at' => now()])->save();
                self::advanceAfterUpload($slot, $actor);

                return $slot;
            }

            $file = self::storeFile($person, $stored, $meta, $name, $actor, self::destination($person, $template, $actor));

            $slot->forceFill([
                'file_id' => $file->id,
                'uploaded_by' => $actor->id,
                'uploaded_at' => now(),
            ])->save();
            self::advanceAfterUpload($slot, $actor);

            return $slot;
        });
    }

    /**
     * A library upload that names a checklist row lands in the slot, not
     * beside it as a second file wearing the slot's review chip.
     *
     * Intake and request links fill slots directly; the Documents tab and the
     * File Library do not, unless the filename matches what {@see fill()}
     * would have given it, "{person}. {requirement label}.pdf".
     */
    public static function adoptOrphan(FileItem $file, ?User $actor): bool
    {
        if ($file->cipDocument()->exists()) {
            return false;
        }

        $person = self::personForFolder($file->folder_id);

        if ($person === null) {
            return false;
        }

        $person->loadMissing('documents');

        $slot = self::slotForOrphanFilename($person, $file->name);

        if ($slot === null || $slot->file_id !== null) {
            return false;
        }

        return DB::transaction(function () use ($slot, $file, $actor) {
            $slot->forceFill([
                'file_id' => $file->id,
                'uploaded_by' => $actor?->id,
                'uploaded_at' => now(),
            ])->save();

            self::advanceAfterUpload($slot, $actor);

            return true;
        });
    }

    /**
     * A slot whose file is gone or in the recycle bin is reset to Pending upload.
     *
     * Library deletes sometimes bypass model observers (folder-tree bulk delete),
     * so this is called on read as well as from {@see CipFileObserver}.
     */
    public static function reconcile(CipDocument $slot, ?User $actor = null, bool $broadcast = true): bool
    {
        if ($slot->isFilled()) {
            return false;
        }

        $status = $slot->status ?? DocumentStatus::PENDING_UPLOAD;

        if ($slot->file_id === null && $status === DocumentStatus::PENDING_UPLOAD) {
            return false;
        }

        DocumentEngine::resetAfterFileDeletion($slot, $actor, $broadcast);

        return true;
    }

    /** Which empty checklist row a loose library upload is naming itself after. */
    private static function slotForOrphanFilename(CipPerson $person, string $filename): ?CipDocument
    {
        $label = self::labelFromFilename($filename);

        if ($label !== null) {
            $slot = $person->documents->first(
                fn (CipDocument $slot) => strcasecmp($slot->label, $label) === 0,
            ) ?? $person->documents->first(
                fn (CipDocument $slot) => strcasecmp(DocumentTypes::label($slot->type), $label) === 0,
            );

            if ($slot !== null) {
                return $slot;
            }
        }

        $normalized = self::normalizeFilename($filename);

        if ($normalized === '') {
            return null;
        }

        $best = null;
        $bestLen = 0;

        foreach ($person->documents as $slot) {
            if ($slot->file_id !== null) {
                continue;
            }

            foreach (array_filter([$slot->label, DocumentTypes::label($slot->type)]) as $candidate) {
                $norm = self::normalizeFilename($candidate);

                if ($norm === '' || mb_strlen($norm) < 4) {
                    continue;
                }

                if (! str_contains($normalized, $norm) && ! str_contains($norm, $normalized)) {
                    continue;
                }

                if (mb_strlen($norm) > $bestLen) {
                    $best = $slot;
                    $bestLen = mb_strlen($norm);
                }
            }
        }

        return $best;
    }

    private static function normalizeFilename(string $name): string
    {
        $name = preg_replace('/\.[^.]+$/', '', $name) ?? $name;
        $name = mb_strtolower($name);
        $name = preg_replace('/[^a-z0-9]+/u', ' ', $name) ?? $name;

        return trim($name);
    }

    /**
     * An upload is what moves a slot along (§12).
     *
     * Filling an empty requirement takes it from Pending upload into
     * Application review; re-uploading against one a reviewer sent back takes
     * Update required to Application review again, the revision loop. Both go
     * through {@see DocumentEngine} rather than writing the column here, so the
     * edge is checked and the change lands in cip_events like every other.
     *
     * A slot already in review, or already ready, is left alone: uploading a
     * better scan of an approved document does not un-approve it, and nothing
     * here should quietly undo a reviewer's decision.
     */
    public static function advanceAfterUpload(CipDocument $slot, ?User $actor): void
    {
        $from = $slot->status ?? DocumentStatus::PENDING_UPLOAD;

        if (! in_array($from, [DocumentStatus::PENDING_UPLOAD, DocumentStatus::UPDATE_REQUIRED], true)) {
            return;
        }

        DocumentEngine::apply($slot, DocumentStatus::APPLICATION_REVIEW, $actor, [
            'reason' => 'upload',
        ]);
    }

    /**
     * A further file for a requirement already answered.
     *
     * One requirement can take more than one sheet of paper, a bio page over
     * two pages, a birth certificate with its translation. The slot still holds
     * the one answer (its unique key allows no second), and a second *version*
     * would bury a separate document inside another one's history, so these are
     * filed into the person's folder alongside it and numbered so the set reads
     * in order.
     */
    public static function attach(CipPerson $person, string $type, UploadedFile $upload, User $actor, int $number): FileItem
    {
        $person->loadMissing('application');
        Confirmation::guard($person->application);

        // The same drawer the slot's first file went into: a bio page's back
        // sheet filed outside its requirement's folder would split one answer
        // across two places.
        $template = self::template($person, $type);

        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
        $stored = Vault::store($upload->getRealPath(), $meta['extension']);
        $name = self::documentName($person, $type, $meta['extension'], $number);

        return DB::transaction(fn () => self::storeFile($person, $stored, $meta, $name, $actor, self::destination($person, $template, $actor)));
    }

    /** "Ada Lovelace - Birth certificate (2).pdf" */
    private static function documentName(CipPerson $person, string $type, string $extension, ?int $number = null): string
    {
        return $person->fullName().' - '.DocumentTypes::label($type).
            ($number ? ' ('.$number.')' : '').'.'.$extension;
    }

    /** One stored upload as a portal file, where {@see destination()} said. */
    private static function storeFile(CipPerson $person, array $stored, array $meta, string $name, User $actor, ?int $folderId): FileItem
    {
        $file = FileItem::create([
            'uuid' => $stored['uuid'],
            'folder_id' => $folderId,
            'name' => $name,
            'extension' => $meta['extension'],
            'mime_type' => $meta['mime'],
            'size' => $stored['size'],
            'disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'checksum' => $stored['checksum'],
            'owner_id' => FolderProvisioner::systemOwnerId($actor),
            'uploaded_by' => $actor->id,
        ]);

        Versions::recordInitial($file, $actor->id);

        return $file;
    }

    /**
     * What a person still owes, the reason a slot is a row and not a file.
     *
     * @return array<int, string>
     */
    public static function outstanding(CipPerson $person): array
    {
        /*
         * Read from the loaded checklist where the caller already has one.
         *
         * This is asked for every person on an application, and an application
         * is a family, so on a sync page of fifty it was three hundred
         * queries against documents the same request had already fetched in
         * full. The filter is the same either way; only where it runs moves.
         */
        if ($person->relationLoaded('documents')) {
            return $person->documents
                ->filter(fn (CipDocument $slot) => ! $slot->isFilled() && $slot->required)
                ->pluck('label')
                ->values()
                ->all();
        }

        return $person->documents()
            ->where('required', true)
            ->whereDoesntHave('file', fn ($query) => $query->whereNull('deleted_at'))
            ->pluck('label')->all();
    }

    /**
     * The template behind a type, matched the way slots are linked to
     * requirements everywhere, the person's applicant type and the slug.
     *
     * The same match that stamps `requirement_id` onto a slot (here and in
     * {@see Requirements}), so resolving by key IS resolving the slot's own
     * requirement, and it also answers for the intake slots that predate the
     * table and carry no requirement_id at all. One query, and only on the
     * upload paths: the sync-scale readers never come through here.
     */
    /**
     * Where an upload answering this SLOT should land, the one resolution,
     * offered to the other doors a document can arrive through. The
     * file-request path files a visitor's upload for a slot it never opened
     * through fill(), and hardcoding the person's folder there put the same
     * document in two different places depending on which door it came in by.
     */
    public static function destinationForSlot(CipDocument $slot, ?User $actor = null): ?int
    {
        $person = $slot->person;

        if ($person === null) {
            return null;
        }

        return self::destination($person, self::template($person, $slot->type), $actor);
    }

    private static function template(CipPerson $person, string $type): ?CipDocumentRequirement
    {
        return CipDocumentRequirement::query()
            ->where('applicant_type', ApplicantType::for($person))
            ->where('key', $type)
            ->first();
    }

    private static function destination(CipPerson $person, ?CipDocumentRequirement $template, User $actor): ?int
    {
        $person->loadMissing('application');
        $application = $person->application;

        $parent = null;

        if ($application?->phase === Phase::POST_APPROVAL
            && $template !== null
            && self::filesInPostApprovalFolder($template)) {
            $parent = Tree::postApprovalPersonFolder($person, null, $actor);
        } elseif ($person->folder_id) {
            $parent = Folder::find($person->folder_id);
        }

        if ($parent === null) {
            return $person->folder_id;
        }

        $name = trim((string) $template?->folder);

        if ($name === '') {
            return $parent->id;
        }

        return Tree::subfolder($parent, $name, $actor)->id;
    }

    /**
     * Post-approval uploads land under the post-approval person folder unless
     * the requirement is only carried forward from pre-approval, in which case
     * the existing file stays where it was filed.
     */
    private static function filesInPostApprovalFolder(CipDocumentRequirement $template): bool
    {
        if (! $template->at_post_approval) {
            return false;
        }

        if ($template->at_pre_approval && $template->carry_forward) {
            return false;
        }

        return true;
    }

    /**
     * The slot a document of this type belongs in, made if it is not there.
     *
     * Takes its label and its mandatory flag from the requirement template
     * where one exists, so a slot created by an upload reads the same as one
     * materialised from the checklist. A type with no template still gets a
     * slot, a document the firm asked for by hand is still a document, and
     * carries the type as its label rather than nothing. The template arrives
     * from {@see fill()}, which resolved it once for this and for the filing
     * destination together.
     */
    private static function slotFor(CipPerson $person, string $type, ?CipDocumentRequirement $requirement): CipDocument
    {
        return CipDocument::firstOrCreate(
            ['person_id' => $person->id, 'type' => $type],
            [
                'application_id' => $person->application_id,
                'requirement_id' => $requirement?->id,
                'label' => $requirement?->label ?? DocumentTypes::label($type),
                'required' => $requirement?->required ?? true,
            ],
        );
    }

    private static function personForFolder(?int $folderId): ?CipPerson
    {
        if ($folderId === null) {
            return null;
        }

        $folder = Folder::find($folderId);

        while ($folder !== null) {
            $person = CipPerson::where('folder_id', $folder->id)->first();

            if ($person !== null) {
                return $person;
            }

            $folder = $folder->parent_id ? Folder::find($folder->parent_id) : null;
        }

        return null;
    }

    /** "{person} - {label}.pdf" → the label half, which is what the slot stores. */
    private static function labelFromFilename(string $name): ?string
    {
        $pos = false;
        $width = 0;
        foreach ([' — ', ' - ', ': '] as $sep) {
            $found = mb_strpos($name, $sep);
            if ($found !== false) {
                $pos = $found;
                $width = mb_strlen($sep);
                break;
            }
        }

        if ($pos === false) {
            return null;
        }

        $tail = mb_substr($name, $pos + $width);
        $tail = preg_replace('/ \(\d+\)(?=\.[^.]+$)/', '', $tail) ?? $tail;
        $tail = preg_replace('/\.[^.]+$/', '', $tail) ?? $tail;
        $tail = trim($tail);

        return $tail !== '' ? $tail : null;
    }
}
