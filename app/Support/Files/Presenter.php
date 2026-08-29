<?php

namespace App\Support\Files;

use App\Models\CipDocument;
use App\Models\FileItem;
use App\Models\FileLibrarySetting;
use App\Models\FileWorkflow;
use App\Models\Folder;
use App\Models\FolderColourPreference;
use App\Models\Share;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;
use App\Support\Files\Workflow\Status;

/**
 * Shapes files/folders into safe JSON for the client. Only the public uuid is
 * ever exposed, never the database id, storage path, or disk. Favourite and
 * share/assignment status are primed in bulk to avoid N+1 queries in listings.
 */
class Presenter
{
    private array $favFile = [];

    private array $favFolder = [];

    /**
     * item_id => the people it is shared with, as person arrays.
     *
     * The names the rest of the payload uses are derived from these rather
     * than fetched again, the Owner column needs faces, and asking the same
     * question twice per listing is how the client directory got slow.
     */
    private array $sharedFile = [];

    private array $sharedFolder = [];

    /** file_id => ['status','label','tone'] for the file's live review state. */
    private array $statusFile = [];

    /**
     * file_id => the CIP slot this file answers, primed with the listing.
     *
     * @var array<int, CipDocument>
     */
    private array $cipFile = [];

    /** file id => ['open' => int, 'unread' => int, 'mentionsMe' => bool] */
    private array $commentFile = [];

    /** folder id => unread comment threads anywhere beneath it */
    private array $commentFolder = [];

    /**
     * Whether {@see self::prime()} has run for this page of items.
     *
     * Every map above is *sparse*: it holds only the rows that exist, because
     * that is what a `whereIn` returns. So `$map[$id] ?? <lazy lookup>` reads
     * "not primed" out of "primed, and this item genuinely has none", and
     * since most files have no share and most folders no colour preference,
     * the fallback fired on nearly every row. Against the remote database
     * that was one ~280ms round trip per row: 50 rows of Recent cost 14s of
     * shares lookups alone, and a folder with 11k children never finished.
     *
     * The flag is the missing bit: once primed, an absent key IS the answer.
     * Single-item callers (store/show/move/copy/restore) never prime and keep
     * the lazy path.
     */
    private bool $primed = false;

    /** folder_id => viewer's personal ['colour'=>?, 'iconName'=>?] preference (user-type folders only) */
    private array $prefRows = [];

    /**
     * id => Folder, ancestors of the primed listing.
     *
     * Used to be every folder in the library. Opening a client's Documents
     * tab then loaded the whole tree into PHP before it could draw twenty
     * rows, the path and audience walks only ever need the ancestors of
     * what is on the page.
     *
     * @var array<int, Folder>
     */
    private array $folderIndex = [];

    /**
     * folder id => recursive counts, primed with the listing so each row
     * does not walk its subtree on its own.
     *
     * @var array<int, array{fileCount: int, folderCount: int, size: int}>
     */
    private array $folderStats = [];

    /**
     * The firm-wide default grant, resolved once. `false` means "not looked up
     * yet", null is a real answer here (the setting can be off).
     *
     * @var array{label: string, role: ?string}|null|false
     */
    private array|null|false $orgDefault = false;

    /** Approved staff, counted once per listing. */
    private ?int $staffCount = null;

    /** @var array<int, array<string, mixed>>|null */
    private ?array $staffPeople = null;

    private ?array $adminPeople = null;

    /**
     * How many people travel on a row. The cell draws four faces and a "+N",
     * so a couple spare is enough for the card to name whoever is shown.
     */
    private const PEOPLE_PREVIEW = 6;

    public function __construct(private User $viewer) {}

    /**
     * Who this presenter is speaking to.
     *
     * Anything measured "for the reader" — read state, favourites, what they
     * may do — has to be measured for the same person the rows were shaped
     * for, so callers building a payload alongside one ask it rather than
     * carrying a second User around and risking the two drifting apart.
     */
    public function viewer(): User
    {
        return $this->viewer;
    }

    /**
     * @param  FileItem[]  $files
     * @param  Folder[]  $folders
     * @param  bool  $folderExtras  Folder subtree work (direct counts, unread
     *                              chips). The sync cursor presents rows with
     *                              stats off and must not pay for them.
     */
    public function prime(array $files, array $folders, bool $folderExtras = true): void
    {
        $fileIds = array_values(array_map(fn ($f) => $f->id, $files));
        $folderIds = array_values(array_map(fn ($f) => $f->id, $folders));

        if ($fileIds) {
            $this->favFile = $this->viewer->favorites()
                ->where('item_type', 'file')->whereIn('item_id', $fileIds)
                ->pluck('item_id')->flip()->all();
        }
        if ($folderIds) {
            $this->favFolder = $this->viewer->favorites()
                ->where('item_type', 'folder')->whereIn('item_id', $folderIds)
                ->pluck('item_id')->flip()->all();
        }

        $this->sharedFile = $this->sharedWithMap('file', $fileIds);
        $this->statusFile = $this->statusMap($fileIds);
        $this->cipFile = $this->cipMap($fileIds);
        $this->commentFile = $this->commentMap($fileIds);
        $this->primed = true;
        $this->attachCipSlots($files);
        $this->sharedFolder = $this->sharedWithMap('folder', $folderIds);
        $this->prefRows = FolderColours::preferenceRows($this->viewer, $folderIds);
        $this->primeFolderIndex($files, $folders);

        if ($folderExtras) {
            $this->folderStats = FolderTree::directCounts($folders);
        }

        // Every row's permission block walks its folder chain through
        // FileAccess. Warming them together turns one round trip per level
        // per row into one per level for the whole page.
        FileAccess::warmChains(array_merge(
            array_map(fn (Folder $f) => $f->id, $folders),
            array_map(fn (FileItem $f) => (int) $f->folder_id, $files),
        ));
    }

    public function file(FileItem $file): array
    {
        $ext = (string) $file->extension;
        $sharedWith = $this->sharedWith('file', $this->sharedFile, $file->id);
        $assignees = array_column($sharedWith, 'name');
        $fileAudience = $this->audienceFor($file->folder);
        // Computed once: the review block reads from it rather than asking
        // FileAccess the same question a second time per row.
        $perms = $this->filePerms($file);

        return [
            'id' => $file->uuid,
            'type' => 'file',
            'name' => $file->name,
            'extension' => $ext,
            'category' => FileType::category($ext),
            'mime' => $file->mime_type,
            'icon' => FileType::icon($ext),
            'previewable' => FileType::isPreviewable($ext),
            'size' => (int) $file->size,
            'sizeLabel' => self::humanSize((int) $file->size),
            // Denormalised on the row, so a listing of 200 files costs no
            // extra queries to show which have been revised.
            'versionNumber' => (int) ($file->version_number ?: 1),
            // What the row's comment indicator draws. Absent (null) when the
            // file has no open thread, so the client has nothing to decide.
            'comments' => $this->commentFile[$file->id] ?? null,
            'folder' => $file->folder ? ['id' => $file->folder->uuid, 'name' => $file->folder->name] : null,
            'path' => $this->folderPath($file->folder),
            'createdAt' => optional($file->created_at)->toIso8601String(),
            'uploadedAt' => optional($file->created_at)->toIso8601String(),
            'modifiedAt' => optional($file->source_modified_at ?? $file->updated_at)->toIso8601String(),
            'updatedAt' => optional($file->updated_at)->toIso8601String(),
            'deletedAt' => optional($file->deleted_at)->toIso8601String(),
            'owner' => $this->person($file->owner),
            'uploadedBy' => $this->person($file->uploader),
            // Everyone on the file, owner first, what the Owner column draws
            // as faces. `assignedTo` stays the bare names it has always been.
            'people' => $this->peopleOn($file->owner, $sharedWith, $fileAudience),
            'peopleTotal' => $this->peopleTotal($file->owner, $sharedWith, $fileAudience),
            'audience' => $fileAudience,
            'assignedTo' => $assignees,
            'shared' => count($assignees) > 0,
            'favorite' => isset($this->favFile[$file->id]),
            /*
             * One badge, from whichever of the three systems applies.
             *
             * A CIP slot's own status wins: it is the document-status workflow
             * the checklist, the Documents tab and the File Library all have
             * to agree on, and a file showing "Application review" beside
             * "Pending review" would be two answers for one document. A
             * client document that is not a slot still uses that same
             * vocabulary on files.review_status. The approval-workflow badge
             * still shows for everything else, and both remain visible in
             * full inside the viewer.
             */
            'status' => $this->fileBadge($file),
            'review' => $this->reviewPayload($file, $perms),
            'permissions' => $perms,
            'downloadUrl' => route('files.download', $file->uuid),
            'previewUrl' => FileType::isPreviewable($ext)
                ? route('files.preview', $file->uuid)
                : (strtolower($ext) === 'svg' ? route('files.thumb', $file->uuid) : null),
            'thumbUrl' => Thumbnail::supportsExt($ext) ? route('files.thumb', $file->uuid) : null,
        ];
    }

    public function folder(Folder $folder, bool $withStats = true): array
    {
        $sharedWith = $this->sharedWith('folder', $this->sharedFolder, $folder->id);
        $assignees = array_column($sharedWith, 'name');
        $folderAudience = $this->audienceFor($folder);

        $stats = $withStats
            ? ($this->folderStats[$folder->id] ?? ['fileCount' => 0, 'folderCount' => 0, 'size' => 0])
            : ['fileCount' => null, 'folderCount' => null, 'size' => null];

        return [
            'id' => $folder->uuid,
            'type' => 'folder',
            'name' => $folder->name,
            'folderType' => $folder->folder_type,
            'colour' => $this->effectiveColour($folder),
            'iconName' => $this->effectiveIcon($folder),
            // What the closed folder is hiding: threads beneath it this reader
            // has not seen. Null when there is nothing to say.
            'comments' => isset($this->commentFolder[$folder->id])
                ? ['unread' => $this->commentFolder[$folder->id]]
                : null,
            'fileCount' => $stats['fileCount'],
            'folderCount' => $stats['folderCount'],
            'size' => $stats['size'],
            'sizeLabel' => $stats['size'] === null ? null : self::humanSize((int) $stats['size']),
            'parent' => $folder->parent ? ['id' => $folder->parent->uuid, 'name' => $folder->parent->name] : null,
            'path' => $this->folderPath($folder->parent),
            'createdAt' => optional($folder->created_at)->toIso8601String(),
            'modifiedAt' => optional($folder->updated_at)->toIso8601String(),
            'deletedAt' => optional($folder->deleted_at)->toIso8601String(),
            'owner' => $this->person($folder->owner),
            'createdBy' => $this->person($folder->creator),
            'people' => $this->peopleOn($folder->owner, $sharedWith, $folderAudience),
            'peopleTotal' => $this->peopleTotal($folder->owner, $sharedWith, $folderAudience),
            // From the folder itself: a folder granted to all staff is shared
            // with them, not merely sitting inside something that is.
            'audience' => $folderAudience,
            'assignedTo' => $assignees,
            'shared' => count($assignees) > 0,
            'favorite' => isset($this->favFolder[$folder->id]),
            'permissions' => $this->folderPerms($folder),
        ];
    }

    /**
     * Full ancestor chain for a folder, root-first, including the folder
     * itself, e.g. for `file()`, pass the file's direct folder and get back
     * every containing folder down to it, so the client can render a full
     * path instead of just the immediate parent's name. Walks an in-memory
     * id => Folder map (one query total, however many items are being
     * presented) rather than lazy-loading `->parent` per item, which would
     * be an N+1 query per ancestor level for a list of files/folders.
     */
    private function folderPath(?Folder $folder): array
    {
        if (! $folder) {
            return [];
        }

        $trail = [];
        $seen = [];
        $node = $folder;

        while ($node && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            array_unshift($trail, ['id' => $node->uuid, 'name' => $node->name]);
            $node = $this->parentOf($node);
        }

        return $trail;
    }

    /**
     * Who can reach this beyond the people named on it.
     *
     * Sharing in this library is mostly not person-to-person. The firm's
     * document libraries are granted to every member of staff at once by the
     * folder they sit in; a client's folder is granted to whichever staff are
     * assigned to them; a personal drive is granted to nobody. There are, in
     * fact, no individual shares at all, so a column that only listed
     * `shares` rows would have been empty on all forty thousand files.
     *
     * A group grant is reported as a group. Thirteen identical faces repeated
     * down thirty thousand rows would say less than the words "All staff", and
     * would be a lie about how the access was given.
     *
     * @return array{label: string, role: ?string}|null
     */
    private function audienceFor(?Folder $folder): ?array
    {
        if (! $folder) {
            return null;
        }

        $seen = [];
        $node = $folder;
        $top = $folder;
        $explicit = null;

        while ($node && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            $top = $node;

            if ($node->folder_type === Folder::TYPE_CLIENT) {
                // Named people would be the staff assigned to that client, and
                // the assignment is the grant, so that is what it says.
                return ['label' => 'The assigned client team', 'role' => null, 'count' => null];
            }

            if ($explicit === null
                && $node->folder_type === Folder::TYPE_ORGANIZATION
                && $node->audience === 'all_staff') {
                $explicit = [
                    'label' => 'Everyone in '.config('app.name', 'the organization'),
                    'role' => ucfirst((string) ($node->audience_role ?: 'viewer')),
                    'count' => $this->staffCount(),
                ];
            }

            $node = $this->parentOf($node);
        }

        // A personal drive is nobody else's, whatever the firm-wide default
        // says. FileAccess stops at the same place, before even the
        // administrator short-circuit. The drives are the user-typed roots.
        if ($top && $top->folder_type === Folder::TYPE_USER) {
            return null;
        }

        if ($explicit) {
            return $explicit;
        }

        // Failing an explicit grant, the firm-wide default is what staff hold
        // over everything that is not a client's or a person's. It is real
        // access, so a folder covered by it is not "private".
        return $this->orgDefault();
    }

    /**
     * How many people a firm-wide grant actually reaches.
     *
     * Counted once per listing, not per row, it is the same number for every
     * file in it. The same figure the file viewer's access panel reports, so
     * the table and the panel do not disagree about one file.
     */
    private function staffCount(): int
    {
        if ($this->staffCount === null) {
            $this->staffCount = User::query()
                ->whereIn('account_type', Role::STAFF)
                ->where('status', User::STATUS_APPROVED)
                ->count();
        }

        return $this->staffCount;
    }

    /** @return array{label: string, role: ?string, count: ?int}|null */
    private function orgDefault(): ?array
    {
        if ($this->orgDefault === false) {
            $this->orgDefault = FileLibrarySetting::defaultOrgAccess()
                ? [
                    'label' => 'Everyone in '.config('app.name', 'the organization'),
                    'role' => ucfirst((string) FileLibrarySetting::defaultOrgRole()),
                    'count' => $this->staffCount(),
                ]
                : null;
        }

        return $this->orgDefault;
    }

    /**
     * Ancestors of the files and folders on this page, not the whole library.
     *
     * @param  FileItem[]  $files
     * @param  Folder[]  $folders
     */
    private function primeFolderIndex(array $files, array $folders): void
    {
        $need = [];

        foreach ($folders as $folder) {
            $this->folderIndex[$folder->id] = $folder;
            if ($folder->parent_id) {
                $need[$folder->parent_id] = true;
            }
        }

        foreach ($files as $file) {
            if ($file->relationLoaded('folder') && $file->folder) {
                $this->folderIndex[$file->folder->id] = $file->folder;
                if ($file->folder->parent_id) {
                    $need[$file->folder->parent_id] = true;
                }
            } elseif ($file->folder_id) {
                $need[$file->folder_id] = true;
            }
        }

        $this->loadAncestors(array_keys($need));
    }

    private function parentOf(Folder $folder): ?Folder
    {
        if (! $folder->parent_id) {
            return null;
        }

        if (! isset($this->folderIndex[$folder->parent_id])) {
            $this->loadAncestors([$folder->parent_id]);
        }

        return $this->folderIndex[$folder->parent_id] ?? null;
    }

    /** @param  list<int>  $ids */
    private function loadAncestors(array $ids): void
    {
        $queue = [];
        foreach ($ids as $id) {
            if ($id && ! isset($this->folderIndex[$id])) {
                $queue[] = $id;
            }
        }

        while ($queue) {
            $rows = Folder::query()
                ->select('id', 'uuid', 'name', 'parent_id', 'folder_type', 'audience', 'audience_role')
                ->whereIn('id', $queue)
                ->get();
            $queue = [];
            foreach ($rows as $row) {
                $this->folderIndex[$row->id] = $row;
                if ($row->parent_id && ! isset($this->folderIndex[$row->parent_id])) {
                    $queue[] = $row->parent_id;
                }
            }
        }
    }

    /**
     * Default/system folders show the one admin-set colour/icon. Regular
     * user folders show the viewer's own preference, primed in bulk by
     * prime(), with a single lazy lookup for callers that skip priming
     * (store/show/move/copy/restore/colour/icon all present one folder at
     * a time).
     */
    private function effectiveColour(Folder $folder): ?string
    {
        if ($folder->folder_type !== Folder::TYPE_USER) {
            return $folder->colour;
        }

        return $this->personalPreference($folder)['colour'] ?? null;
    }

    private function effectiveIcon(Folder $folder): ?string
    {
        if ($folder->folder_type !== Folder::TYPE_USER) {
            return $folder->icon_name;
        }

        return $this->personalPreference($folder)['iconName'] ?? null;
    }

    /** @return array{colour: ?string, iconName: ?string} */
    private function personalPreference(Folder $folder): array
    {
        if (array_key_exists($folder->id, $this->prefRows)) {
            return $this->prefRows[$folder->id];
        }

        // Primed and absent means the viewer has set nothing here. Only the
        // one-folder callers below get to ask the database.
        if ($this->primed) {
            return ['colour' => null, 'iconName' => null];
        }

        $row = FolderColourPreference::where('user_id', $this->viewer->id)
            ->where('folder_id', $folder->id)->first(['colour', 'icon_name']);

        $resolved = ['colour' => $row?->colour, 'iconName' => $row?->icon_name];
        $this->prefRows[$folder->id] = $resolved;

        return $resolved;
    }

    private function filePerms(FileItem $file): array
    {
        return FileAccess::fileListingPerms($this->viewer, $file);
    }

    private function folderPerms(Folder $folder): array
    {
        $perms = FileAccess::folderListingPerms($this->viewer, $folder);
        $canTint = $folder->folder_type === Folder::TYPE_USER
            ? ($perms['view'] ?? false)
            : FileAccess::isAdmin($this->viewer);
        $perms['colour'] = $canTint;
        $perms['icon'] = $canTint;
        unset($perms['view']);

        return $perms;
    }

    private function person(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            // The id is what decides whether the person card's Message and
            // call buttons work at all, without it they are drawn disabled.
            'userId' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->avatar_url,
        ];
    }

    /**
     * Who a set of items is shared with, as people rather than names.
     *
     * The Owner column draws faces now, and a face needs more than a name: an
     * avatar to show, an id to reach the person by, and the role they hold
     * here to put under their name in the card. `assignedTo` still carries the
     * bare names it always did, the Sharing column and the details panel read
     * it, so this is additional rather than a change of shape.
     *
     * @param  array<int, int>  $ids
     * @return array<int, array<int, array<string, mixed>>>
     */
    /**
     * One item's people, from the primed map when there is one.
     *
     * @param  array<int, array<int, array<string, mixed>>>  $map
     * @return array<int, array<string, mixed>>
     */
    private function sharedWith(string $type, array $map, int $id): array
    {
        if ($this->primed) {
            return $map[$id] ?? [];
        }

        return $this->sharedWithMap($type, [$id])[$id] ?? [];
    }

    private function sharedWithMap(string $type, array $ids): array
    {
        if (! $ids) {
            return [];
        }

        $map = [];
        Share::query()
            ->where('kind', 'user')
            ->where('item_type', $type)
            ->whereIn('item_id', $ids)
            ->whereNull('revoked_at')
            // avatar_url is an accessor over these columns; selecting only
            // id+name would make every face a silent fallback to initials.
            ->with('targetUser')
            ->get()
            ->filter(fn (Share $s) => $s->isActive())
            ->each(function (Share $s) use (&$map) {
                if (! $s->targetUser) {
                    return;
                }
                $map[$s->item_id][] = $this->person($s->targetUser) + [
                    'roles' => [ucfirst((string) $s->role)],
                ];
            });

        return $map;
    }

    /**
     * Everyone on this item, owner first.
     *
     * The owner is a person on the record like any other, they are simply the
     * one who is always there, so the column reads as one answer to "who has
     * this" rather than an owner plus a separate sharing fact. A person shared
     * with who also owns it appears once, with both roles.
     *
     * @param  array<int, array<string, mixed>>  $sharedWith
     * @return array<int, array<string, mixed>>
     */
    private function peopleOn(?User $owner, array $sharedWith, ?array $audience = null): array
    {
        $people = [];

        if ($owner) {
            $people[] = $this->person($owner) + ['roles' => ['Owner']];
        }

        foreach ($sharedWith as $person) {
            $existing = null;
            foreach ($people as $i => $already) {
                if ($already['userId'] === $person['userId']) {
                    $existing = $i;
                    break;
                }
            }

            if ($existing === null) {
                $people[] = $person;

                continue;
            }

            $people[$existing]['roles'] = array_values(array_unique(
                array_merge($people[$existing]['roles'], $person['roles'])
            ));
        }

        /*
         * A firm-wide grant is people too.
         *
         * Nothing here is shared person to person, so an owner and no one else
         * was all the column ever had to draw, one face on every row, which
         * answers nothing. The grant reaches every member of staff, so they are
         * who it is shared with, and they are shown: the owner, then the
         * administrators, then everyone else, which is the order somebody
         * scanning for "who do I ask about this" wants them in.
         *
         * Only the first few travel, the cell draws four and a "+N", with the
         * real figure alongside so the "+N" can be honest.
         */
        /*
         * Administrators are always on it.
         *
         * They hold every capability by definition, so FileAccess hands them
         * `full` on anything without a share existing, which made them
         * invisible here, because this list was built from shares and grants.
         * A client folder is the case that showed it: carved out of the
         * firm-wide audience, so nothing filled the list and it read "one
         * person" while three administrators could open every document in it.
         * The file viewer's own panel already says this; the listing now
         * agrees with it.
         */
        $people = $this->mergePeople($people, $this->adminPeople());

        if ($audience && ($audience['count'] ?? null)) {
            $people = $this->mergePeople($people, $this->staffPeople());
        }

        return $people;
    }

    /**
     * Add people not already listed, up to what the cell draws.
     *
     * @param  array<int, array<string, mixed>>  $people
     * @param  array<int, array<string, mixed>>  $more
     * @return array<int, array<string, mixed>>
     */
    private function mergePeople(array $people, array $more): array
    {
        $seen = array_column($people, 'userId');

        foreach ($more as $member) {
            if (count($people) >= self::PEOPLE_PREVIEW) {
                break;
            }
            if (in_array($member['userId'], $seen, true)) {
                continue;
            }
            $people[] = $member;
            $seen[] = $member['userId'];
        }

        return $people;
    }

    /**
     * How many people can reach it in total, what the "+N" counts up to.
     *
     * @param  array<int, array<string, mixed>>  $sharedWith
     */
    private function peopleTotal(?User $owner, array $sharedWith, ?array $audience): int
    {
        if ($audience && ($audience['count'] ?? null)) {
            // The grant reaches every member of staff; the owner is already one
            // of them when they are staff, and is one more when they are not.
            // Asked of the account, not of staffPeople(), that list is cut to
            // the handful the cell draws, so the owner may not be in it.
            $ownerIsStaff = $owner && in_array($owner->account_type, Role::STAFF, true);

            return $audience['count'] + (($owner && ! $ownerIsStaff) ? 1 : 0);
        }

        // Administrators reach it too, so they are part of the count, the
        // "+N" has to add up to everyone who can open the thing.
        $ids = array_unique(array_filter(array_merge(
            [$owner?->id],
            array_column($sharedWith, 'userId'),
            $this->adminIds(),
        )));

        return max(1, count($ids));
    }

    /**
     * Every approved administrator, built once per listing.
     *
     * Not cut to the preview like staffPeople(): the count has to be the real
     * number of administrators, and there are never many of them.
     *
     * @return array<int, array<string, mixed>>
     */
    private function adminPeople(): array
    {
        if ($this->adminPeople === null) {
            $this->adminPeople = User::query()
                ->where('account_type', Role::ADMINISTRATOR)
                ->where('status', User::STATUS_APPROVED)
                ->orderBy('name')
                ->get()
                ->map(fn (User $u) => $this->person($u) + ['roles' => ['Administrator']])
                ->all();
        }

        return $this->adminPeople;
    }

    /** @return array<int, int> */
    private function adminIds(): array
    {
        return array_column($this->adminPeople(), 'userId');
    }

    /**
     * Approved staff, administrators first, built once per listing.
     *
     * The same people for every row a firm-wide grant covers, so building it
     * per file would be the same query forty thousand times.
     *
     * @return array<int, array<string, mixed>>
     */
    private function staffPeople(): array
    {
        if ($this->staffPeople === null) {
            $this->staffPeople = User::query()
                ->whereIn('account_type', Role::STAFF)
                ->where('status', User::STATUS_APPROVED)
                // Administrator before Employee, then by name, a stable order,
                // so a face does not move between one row and the next.
                ->orderByRaw('case when account_type = ? then 0 else 1 end', [Role::ADMINISTRATOR])
                ->orderBy('name')
                ->limit(self::PEOPLE_PREVIEW)
                ->get()
                ->map(fn (User $u) => $this->person($u) + ['roles' => [$u->account_type]])
                ->all();
        }

        return $this->staffPeople;
    }

    /**
     * The CIP slots these files answer, keyed by file id.
     *
     * @param  int[]  $fileIds
     * @return array<int, CipDocument>
     */
    private function cipMap(array $fileIds): array
    {
        if (! $fileIds) {
            return [];
        }

        return CipDocument::query()
            ->whereIn('file_id', $fileIds)
            // Package::locksFile reads the slot's application to decide
            // whether §17 has frozen it; without this each slot loads its own.
            ->with('application')
            ->get()
            ->keyBy('file_id')
            ->all();
    }

    /**
     * Hand the slot map to the models themselves.
     *
     * `Package::locksFile`, reached five times per row, once per ability the
     * §17 freeze covers, reads `cipDocument` off the file and falls back to
     * a query when the relation is not loaded. It has no presenter to ask, so
     * priming our own map left it querying: 250 round trips to draw 50 rows,
     * 70 of the 104 seconds Recent took. Setting the relation is exactly what
     * `with('cipDocument')` would have done, and doing it here covers every
     * caller that primes rather than each listing query in turn.
     *
     * @param  FileItem[]  $files
     */
    private function attachCipSlots(array $files): void
    {
        foreach ($files as $file) {
            if (! $file->relationLoaded('cipDocument')) {
                $file->setRelation('cipDocument', $this->cipFile[$file->id] ?? null);
            }
        }
    }

    private function cipSlot(FileItem $file): ?CipDocument
    {
        if ($this->primed) {
            return $this->cipFile[$file->id] ?? null;
        }

        return $file->cipDocument;
    }

    /** @return array{status:string,label:string,tone:string}|null */
    private function fileBadge(FileItem $file): ?array
    {
        $slot = $this->cipSlot($file);

        if ($slot) {
            return DocumentStatus::badge($slot->status ?? DocumentStatus::PENDING_UPLOAD);
        }

        return ReviewStatus::badge($file->review_status)
            ?? ($this->statusFile[$file->id] ?? null);
    }

    /**
     * The picker the File Library and the viewer hang off this file.
     *
     * CIP slots travel {@see DocumentEngine}'s edges and need `cip.review` to
     * move; every other client document is the library's any-to-any set.
     * Putting the slot's status in this block, not files.review_status, is
     * what keeps the chip on the row and the chip in the panel the same fact.
     *
     * @param  array<string, bool>  $perms
     * @return array<string, mixed>
     */
    private function reviewPayload(FileItem $file, array $perms): array
    {
        $slot = $this->cipSlot($file);

        if ($slot) {
            $status = $slot->status ?? DocumentStatus::PENDING_UPLOAD;
            // Re-upload is what puts a slot back into application review.
            // Offering that status in the picker would let a reviewer skip
            // the new version the revision loop is for.
            $next = array_values(array_filter(
                DocumentEngine::next($slot),
                fn (string $to) => $to !== DocumentStatus::APPLICATION_REVIEW
                    && $to !== DocumentStatus::PENDING_UPLOAD,
            ));
            $overrides = DocumentEngine::availableOverrides($slot, $this->viewer);

            return [
                'status' => $status,
                'label' => DocumentStatus::label($status),
                'note' => $file->review_note,
                'reviewedAt' => optional($file->reviewed_at)->toIso8601String(),
                'reviewedBy' => $file->reviewed_by ? $this->person($file->reviewer) : null,
                'canReview' => $perms['review'] && (
                    CipAccess::can($this->viewer, 'cip.review')
                    || CipAccess::canOverrideStatus($this->viewer)
                ),
                'all' => ReviewStatus::ALL,
                'next' => $next,
                'overrides' => $overrides,
            ];
        }

        return [
            'status' => ReviewStatus::normalize($file->review_status) ?? $file->review_status,
            'label' => ReviewStatus::label($file->review_status),
            'note' => $file->review_note,
            'reviewedAt' => optional($file->reviewed_at)->toIso8601String(),
            'reviewedBy' => $file->reviewed_by ? $this->person($file->reviewer) : null,
            'canReview' => $perms['review'],
            'all' => ReviewStatus::ALL,
            'next' => ReviewStatus::next($file->review_status),
        ];
    }

    /** @see CommentReads::flagsForFiles — one definition, three surfaces. */
    private function commentMap(array $fileIds): array
    {
        return CommentReads::flagsForFiles($this->viewer, $fileIds);
    }

    /**
     * The review state of many files, in one query.
     *
     * Derived from the workflows rather than stored on the file. A column
     * would be a second answer to a question the workflow tables already
     * answer, and the two would part company the first time a request was
     * cancelled, expired or superseded, leaving a row reading "Approved"
     * with nothing behind it. Nothing to backfill and nothing to keep in step.
     *
     * The rule matches Engine::activeFor: the newest unfinished request, or
     * failing that the newest request at all, so a settled file still shows
     * how it settled. Done as one grouped pass because the alternative is a
     * query per row, and a folder listing is 200 rows.
     *
     * @param  int[]  $fileIds
     * @return array<int, array{status:string,label:string,tone:string}>
     */
    private function statusMap(array $fileIds): array
    {
        if (! $fileIds) {
            return [];
        }

        $rows = FileWorkflow::whereIn('file_id', $fileIds)
            ->orderBy('file_id')
            ->orderByDesc('id')
            ->get(['file_id', 'status']);

        $out = [];

        foreach ($rows as $row) {
            $open = ! Status::isTerminal($row->status);

            // Rows arrive newest-first per file. Keep the first one seen, then
            // let a later *open* request replace a settled one, the same
            // "unfinished wins" precedence activeFor applies.
            if (isset($out[$row->file_id]) && ! ($open && ! $out[$row->file_id]['open'])) {
                continue;
            }

            $out[$row->file_id] = [
                'status' => $row->status,
                'label' => Status::label($row->status),
                'tone' => Status::tone($row->status),
                'open' => $open,
            ];
        }

        return $out;
    }

    public static function humanSize(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $power = min((int) floor(log($bytes, 1024)), count($units) - 1);
        $value = $bytes / (1024 ** $power);

        return ($power === 0 ? (int) $value : round($value, 1)).' '.$units[$power];
    }
}
