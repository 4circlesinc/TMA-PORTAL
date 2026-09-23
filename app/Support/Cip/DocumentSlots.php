<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Companies\ContactIdentity;
use App\Support\Files\FileType;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Naming;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Auth\Access\AuthorizationException;
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
     * True while {@see storeFile()} is writing a slot's own FileItem, so the
     * observer must not also adopt that file into a G-series extra.
     */
    private static bool $storing = false;

    /** What an Additional documents upload is called when it arrives nameless. */
    private const LABEL_FALLBACK = 'Additional document';

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
    public static function fill(CipPerson $person, string $type, UploadedFile $upload, User $actor, ?string $givenName = null, bool $replace = false): CipDocument
    {
        $person->loadMissing('application');

        // Resolved once, for the slot AND the destination, the same single
        // query slotFor always ran, not a second one beside it.
        $template = self::template($person, $type);
        $slot = self::slotFor($person, $type, $template);
        Confirmation::guardDocument($slot);

        // $replace is the caller saying this upload is meant to supersede
        // what is filed — the Upload new version door, not an autosave
        // re-sending a scan it already filed. Without it a deliberate
        // replacement is indistinguishable from the repeat, and refusing
        // both is what left a new photo sitting behind the old one.
        if (! $replace
            && $slot->file_id
            && ($slot->status ?? DocumentStatus::PENDING_UPLOAD) !== DocumentStatus::UPDATE_REQUIRED) {
            throw new \InvalidArgumentException(
                DocumentTypes::label($type).' is already filed. Upload a new version from the file viewer.',
            );
        }

        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
        $stored = Vault::store($upload->getRealPath(), $meta['extension']);

        // G-series extras take the paper's name: `G1 - Marriage Certificate`.
        // Pack scans keep "{person} - {type}". A scan0001.pdf tells a reviewer nothing.
        $filedLabel = AddOnRequirements::isAdditional($type)
            ? AddOnRequirements::filedLabel($type, $givenName ?: $upload->getClientOriginalName())
            : null;

        $name = self::documentName(
            $person,
            $type,
            $meta['extension'],
            null,
            $template,
            $filedLabel,
            $upload->getClientOriginalName(),
        );

        return DB::transaction(function () use ($slot, $person, $template, $stored, $meta, $name, $actor, $type, $filedLabel) {
            if ($slot->file_id && $file = $slot->file) {
                Versions::addStored($file, $actor, $stored, $meta);
                $slot->forceFill([
                    'uploaded_by' => $actor->id,
                    'company_member_id' => ContactIdentity::stamp(
                        $actor,
                        ContactIdentity::companyIdForApplication($person->application),
                    )['company_member_id'],
                    'uploaded_at' => now(),
                ])->save();
                self::advanceAfterUpload($slot, $actor);

                return $slot;
            }

            $file = self::storeFile($person, $stored, $meta, $name, $actor, self::destination($person, $template, $actor, $type));

            $attributes = [
                'file_id' => $file->id,
                'uploaded_by' => $actor->id,
                'company_member_id' => ContactIdentity::stamp(
                    $actor,
                    ContactIdentity::companyIdForApplication($person->application),
                )['company_member_id'],
                'uploaded_at' => now(),
            ];
            if ($filedLabel !== null) {
                $attributes['label'] = $filedLabel;
            }
            $slot->forceFill($attributes)->save();
            $slot->setRelation('file', $file);
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

        if (self::$storing) {
            return false;
        }

        $person = self::personForFolder($file->folder_id);

        if ($person === null) {
            return self::adoptAddOnAdditional($file, $actor);
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
                'company_member_id' => ContactIdentity::stamp(
                    $actor,
                    ContactIdentity::companyIdForFile($file),
                )['company_member_id'],
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
     * An upload is what moves a slot along (section 12).
     *
     * Filling an empty requirement takes it from Pending upload into
     * Application review; re-uploading against one a reviewer sent back takes
     * Update required to Application review again, the revision loop. Both go
     * through {@see DocumentEngine} rather than writing the column here, so the
     * edge is checked and the change lands in cip_events like every other.
     *
     * A slot already in review, or already ready, is left alone: uploading a
     * better scan of an approved document does not un-approve it, and nothing
     * here should quietly undo a reviewer's decision. Answering a refusal is
     * different: that re-upload also settles the application, so the file
     * leaves Updates Required when its last refused slot does.
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

        /*
         * The application follows the checklist, whichever way the slot came.
         *
         * A re-upload against a refused slot is the provider side answering
         * Updates Required: once nothing is still refused, the file is the
         * officer's to read again and goes back without anybody typing it.
         * That was the only case this handled.
         *
         * A FIRST upload matters too, but only in post-approval, where the
         * file may already be sitting on a "ready to go" label. An optional
         * document filed after the required ones were cleared left the file
         * on Apply for COR / Apply for NIC carrying a scan nobody had read —
         * a package that calls itself ready while holding an unassessed
         * document. Section 5 is about EVERY document being marked Ready for
         * submission, not only the required ones, so the file steps back to
         * collecting until this one is read.
         *
         * Pre-approval is deliberately left alone: there the officer drives
         * Review Applications → Assessment feedback by hand, and settling on
         * a fresh upload would walk the file forward under them.
         */
        $application = $slot->loadMissing('application')->application;
        $post = ($application?->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL;

        if ($from !== DocumentStatus::UPDATE_REQUIRED && ! $post) {
            return;
        }

        try {
            Review::settle($application, $actor);
        } catch (\InvalidArgumentException|AuthorizationException $e) {
            // The slot already moved. Application inference must not
            // undo the upload that just landed.
            report($e);
        }
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

        // The same drawer the slot's first file went into: a bio page's back
        // sheet filed outside its requirement's folder would split one answer
        // across two places.
        $template = self::template($person, $type);
        $slot = self::slotFor($person, $type, $template);
        Confirmation::guardDocument($slot);

        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
        $stored = Vault::store($upload->getRealPath(), $meta['extension']);
        $name = self::documentName(
            $person,
            $type,
            $meta['extension'],
            // The open box numbers nothing: its files are separate papers, not
            // further sheets of one answer, and each keeps the name it came with.
            AdditionalDocuments::is($type) ? null : $number,
            $template,
            AddOnRequirements::isAdditional($type) ? $slot->label : null,
            $upload->getClientOriginalName(),
        );

        return DB::transaction(fn () => self::storeFile($person, $stored, $meta, $name, $actor, self::destination($person, $template, $actor, $type)));
    }

    /**
     * "Ada Lovelace - Birth certificate (2).pdf", the G-series label as filed,
     * or — for the open Additional documents box — the name the file arrived
     * with, untouched.
     *
     * The box holds the papers no checklist named, so the sender's own
     * filename is the only description of them there is. Collisions are
     * settled by {@see Naming::nextAvailable} at storeFile(), the same way two
     * files of one name are settled anywhere else in the library, rather than
     * by a stem-and-number scheme that would overwrite that description.
     */
    private static function documentName(
        CipPerson $person,
        string $type,
        string $extension,
        ?int $number = null,
        ?CipDocumentRequirement $template = null,
        ?string $filedLabel = null,
        ?string $originalName = null,
    ): string {
        if (AdditionalDocuments::is($type)) {
            $given = Naming::clean((string) $originalName);

            if ($given === '' || $given === '.'.$extension) {
                $given = self::LABEL_FALLBACK.'.'.$extension;
            }

            return $given;
        }

        if (AddOnRequirements::isAdditional($type)) {
            $label = $filedLabel ?: $template?->label ?: AddOnRequirements::filedLabel($type, '');

            return $label.($number ? ' ('.$number.')' : '').'.'.$extension;
        }

        return $person->fullName().' - '.DocumentTypes::label($type).
            ($number ? ' ('.$number.')' : '').'.'.$extension;
    }

    /** One stored upload as a portal file, where {@see destination()} said. */
    private static function storeFile(CipPerson $person, array $stored, array $meta, string $name, User $actor, ?int $folderId): FileItem
    {
        self::$storing = true;

        try {
            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $folderId,
                'name' => self::freeName($name, $folderId),
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
        } finally {
            self::$storing = false;
        }
    }

    /**
     * The same name if the drawer is free, else "name (1).pdf".
     *
     * Slot names are unique by construction — one person, one requirement —
     * but the open Additional documents box keeps whatever filename arrived,
     * so two scans really can both be called `scan.pdf`. Letting the second
     * take the first's name would leave two indistinguishable rows in the
     * drawer; the library settles that everywhere else this way.
     */
    private static function freeName(string $name, ?int $folderId): string
    {
        $name = Naming::clean($name);

        if ($name === '' || $folderId === null) {
            return $name;
        }

        return Naming::nextAvailable(
            $name,
            fn (string $candidate) => FileItem::query()
                ->where('folder_id', $folderId)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                ->exists(),
        );
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

        return self::destination($person, $slot->requirement ?? self::template($person, $slot->type), $actor, $slot->type);
    }

    /**
     * Put this person's post-approval slot files in the pack drawers.
     *
     * Uploads attach to the checklist even when the FileItem landed outside
     * the post-approval tree: a null folder, the original package folder, or
     * a numbered SharePoint copy that was later recycled. Opening the file
     * (or the Documents tab) files them where the tree actually is.
     */
    public static function placePostApprovalFiles(CipPerson $person, ?User $actor = null): void
    {
        $person->loadMissing(['application', 'documents.file', 'documents.requirement']);

        if (($person->application?->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return;
        }

        foreach ($person->documents as $slot) {
            $files = self::filesForSlot($slot);
            if ($files === []) {
                continue;
            }

            $template = $slot->requirement ?? self::template($person, $slot->type);
            $belongsInPost = $template !== null && self::filesInPostApprovalFolder($template);
            $intoPassport = self::isDigitalPassportPhoto($template?->key ?? $slot->type);
            $homeless = collect($files)->contains(fn (FileItem $file) => self::fileHasNoLiveFolder($file));

            /*
             * Carry-forward intake scans (bio page, birth certificate) stay
             * in the original person folder when there is one. Passport
             * photos are the exception: post-approval files them under the
             * Passport drawer so Client documents shows them with the pack.
             * A file opened straight into post-approval has no original
             * folder, so those scans were attached with folder_id NULL.
             */
            if (! $belongsInPost && ! $homeless && ! $intoPassport) {
                continue;
            }

            $destId = self::destination($person, $template, $actor, $slot->type);
            if ($destId === null) {
                continue;
            }

            foreach ($files as $file) {
                self::moveFileTo($file, $destId);
            }
        }
    }

    /**
     * @return list<FileItem>
     */
    private static function filesForSlot(CipDocument $slot): array
    {
        if (! $slot->file_id) {
            return [];
        }

        $file = FileItem::withTrashed()->find($slot->file_id);

        return $file ? [$file] : [];
    }

    private static function fileHasNoLiveFolder(FileItem $file): bool
    {
        if ($file->trashed() || $file->folder_id === null) {
            return true;
        }

        $folder = Folder::withTrashed()->find($file->folder_id);

        return $folder === null || $folder->trashed();
    }

    private static function moveFileTo(FileItem $file, int $destId): void
    {
        if ($file->trashed()) {
            $file->restore();
        }

        if ((int) $file->folder_id === $destId) {
            return;
        }

        $name = Naming::nextAvailable(
            $file->name,
            fn (string $candidate) => FileItem::query()
                ->where('folder_id', $destId)
                ->whereKeyNot($file->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                ->exists(),
        );

        $file->forceFill([
            'folder_id' => $destId,
            'name' => $name,
        ])->save();
    }

    private static function template(CipPerson $person, string $type): ?CipDocumentRequirement
    {
        return CipDocumentRequirement::query()
            ->where('applicant_type', ApplicantType::for($person))
            ->where('key', $type)
            ->first();
    }

    private static function destination(CipPerson $person, ?CipDocumentRequirement $template, ?User $actor, ?string $type = null): ?int
    {
        $person->loadMissing('application');
        $application = $person->application;

        if (($application?->phase ?? '') === Phase::ADD_ON) {
            return self::addOnDestination($person, $template, $actor, $type);
        }

        /*
         * Digital passport photos still live on the COR checklist (they
         * carry forward), but the post-approval library files them in the
         * Passport drawer — the same place as the physical-photo scans.
         */
        if (($application?->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
            && self::isDigitalPassportPhoto($template?->key)) {
            $parent = Tree::postApprovalPersonFolder($person, null, $actor);

            return $parent
                ? Tree::subfolder($parent, PassportRequirements::FOLDER, $actor)->id
                : $person->folder_id;
        }

        $intoPost = ($application?->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
            && ($template === null || self::filesInPostApprovalFolder($template));

        $parent = null;

        if ($intoPost) {
            $parent = Tree::postApprovalPersonFolder($person, null, $actor);
        } elseif ($person->folder_id) {
            $parent = Folder::find($person->folder_id);
        }

        if ($parent === null && ($application?->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
            $parent = Tree::postApprovalPersonFolder($person, null, $actor);
        }

        if ($parent === null) {
            return $person->folder_id;
        }

        $name = trim((string) $template?->folder);

        if ($name === '') {
            return $parent->id;
        }

        // COR / NIC / Passport pack templates belong under the post-approval
        // person folder. A carried birth certificate still names folder NIC so
        // the checklist can stage it, but an intake upload must not grow that
        // drawer inside the original package tree. A pre-approval template that
        // happens to use the same folder word (an administrator writing
        // "Passport" on the bio page) is a named drawer, not a pack.
        $pack = $template ? Pack::of($template) : null;
        if ($pack !== null && ($template === null || ! self::filesInPostApprovalFolder($template))) {
            return $parent->id;
        }

        return Tree::subfolder($parent, $name, $actor)->id;
    }

    /**
     * Post-approval uploads land under the post-approval person folder unless
     * the requirement is only carried forward from pre-approval, in which case
     * the existing file stays where it was filed. Digital passport photos are
     * carried forward on the checklist but still file into the Passport drawer.
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
     * Put this person's Add-On slot files in the drawers the brief names.
     *
     * Pack scans that landed in Add-On Applicant (the old fallback when the
     * application tree was not ready, or a library drop into the person
     * folder) are moved into Supporting Documents; G-series extras into
     * Additional Documents. Opening the file, or browsing its folders, is
     * enough to heal them — the same pattern as {@see placePostApprovalFiles()}.
     */
    public static function placeAddOnFiles(CipPerson $person, ?User $actor = null): void
    {
        $person->loadMissing(['application', 'documents.file', 'documents.requirement']);

        if (($person->application?->phase ?? '') !== Phase::ADD_ON) {
            return;
        }

        foreach ($person->documents as $slot) {
            $files = self::filesForSlot($slot);
            if ($files === []) {
                continue;
            }

            $template = $slot->requirement ?? self::template($person, $slot->type);
            $destId = self::destination($person, $template, $actor, $slot->type);
            if ($destId === null) {
                continue;
            }

            foreach ($files as $file) {
                if ((int) $file->folder_id === (int) $destId) {
                    continue;
                }

                self::moveFileTo($file, $destId);
            }
        }
    }

    /**
     * Identity records (the passport photo) stay in Add-On Applicant.
     * G1–G3 supplemental papers go in Additional Documents. Every other
     * required scan for that Add-On type goes in Supporting Documents, so
     * the four drawers the brief names stay distinct.
     */
    private static function addOnDestination(CipPerson $person, ?CipDocumentRequirement $template, ?User $actor, ?string $type = null): ?int
    {
        $key = $template?->key ?? $type;
        if (self::isDigitalPassportPhoto($key)) {
            return $person->folder_id;
        }

        $person->loadMissing('application');
        $application = $person->application;
        $root = $application?->folder_id ? Folder::find($application->folder_id) : null;

        /*
         * Never dump pack scans into Add-On Applicant. That drawer is the
         * person's identity folder; Supporting / Additional are where the
         * Document Requirements list files. If the tree is not open yet,
         * open it rather than filing beside the passport photo.
         */
        if ($root === null && $application !== null) {
            $root = Tree::provision($application, $actor);
            $application->refresh();
            $person->setRelation('application', $application);
            $person->refresh();
            $root = $application->folder_id ? Folder::find($application->folder_id) : $root;
        }

        if ($root === null) {
            return $person->folder_id;
        }

        $named = trim((string) $template?->folder);
        if ($named === Tree::ADDITIONAL || AddOnRequirements::isAdditional((string) $key)) {
            return Tree::subfolder($root, Tree::ADDITIONAL, $actor)->id;
        }

        return Tree::subfolder($root, Tree::SUPPORTING, $actor)->id;
    }

    private static function isDigitalPassportPhoto(?string $key): bool
    {
        return $key === DocumentTypes::PASSPORT_PHOTO;
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

    /**
     * A drop into an Add-On Additional Documents drawer fills the next empty
     * G1 / G2 / G3 slot and names the file `G{n} - {paper}`.
     *
     * Additional Documents hangs off the application, not the person, so
     * {@see personForFolder()} cannot see these uploads. Purpose drawers
     * (Non-Compliance / Queries / DD Query) keep their own naming.
     */
    private static function adoptAddOnAdditional(FileItem $file, ?User $actor): bool
    {
        $folder = Folder::find($file->folder_id);
        if ($folder === null) {
            return false;
        }

        $walk = $folder;
        while ($walk !== null) {
            foreach (Tree::ADDITIONAL_DRAWERS as $drawer) {
                if (Tree::isDrawerVariant($drawer, $walk->name)) {
                    return false;
                }
            }
            $walk = $walk->parent_id ? Folder::find($walk->parent_id) : null;
        }

        $application = self::addOnApplicationForAdditionalFolder($file->folder_id);
        if ($application === null) {
            return false;
        }

        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)
            ?? $application->people->first();
        if ($person === null) {
            return false;
        }

        $person->setRelation('application', $application);
        $person->loadMissing('documents');

        $slot = null;
        foreach (AddOnRequirements::ADDITIONAL_KEYS as $key) {
            $candidate = $person->documents->firstWhere('type', $key);
            if ($candidate !== null && $candidate->file_id === null) {
                $slot = $candidate;
                break;
            }
        }

        if ($slot === null) {
            return false;
        }

        $label = AddOnRequirements::filedLabel($slot->type, $file->name);
        $extension = ltrim((string) ($file->extension ?: pathinfo($file->name, PATHINFO_EXTENSION)), '.');
        $desired = Naming::clean($label.($extension !== '' ? '.'.$extension : ''));

        return DB::transaction(function () use ($slot, $file, $actor, $label, $desired) {
            if ($desired !== '' && $file->name !== $desired) {
                $file->forceFill(['name' => $desired])->save();
            }

            $slot->forceFill([
                'label' => $label,
                'file_id' => $file->id,
                'uploaded_by' => $actor?->id,
                'company_member_id' => ContactIdentity::stamp(
                    $actor,
                    ContactIdentity::companyIdForFile($file),
                )['company_member_id'],
                'uploaded_at' => now(),
            ])->save();

            self::advanceAfterUpload($slot, $actor);

            return true;
        });
    }

    private static function addOnApplicationForAdditionalFolder(?int $folderId): ?CipApplication
    {
        $folder = Folder::find($folderId);

        while ($folder !== null) {
            if (Tree::isDrawerVariant(Tree::ADDITIONAL, $folder->name) && $folder->parent_id) {
                $application = CipApplication::query()
                    ->where('folder_id', $folder->parent_id)
                    ->where('phase', Phase::ADD_ON)
                    ->first();

                if ($application !== null) {
                    $application->loadMissing('people');

                    return $application;
                }
            }

            $folder = $folder->parent_id ? Folder::find($folder->parent_id) : null;
        }

        return null;
    }

    private static function personForFolder(?int $folderId): ?CipPerson
    {
        if ($folderId === null) {
            return null;
        }

        $folder = Folder::find($folderId);

        while ($folder !== null) {
            $person = Tree::personAt($folder);

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
