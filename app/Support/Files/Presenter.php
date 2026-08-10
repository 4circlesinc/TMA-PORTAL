<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\FileLibrarySetting;
use App\Models\FileWorkflow;
use App\Models\Folder;
use App\Models\FolderColourPreference;
use App\Models\Share;
use App\Models\User;
use App\Support\Files\Workflow\Status;

/**
 * Shapes files/folders into safe JSON for the client. Only the public uuid is
 * ever exposed — never the database id, storage path, or disk. Favourite and
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
     * than fetched again — the Owner column needs faces, and asking the same
     * question twice per listing is how the client directory got slow.
     */
    private array $sharedFile = [];

    private array $sharedFolder = [];

    /** file_id => ['status','label','tone'] for the file's live review state. */
    private array $statusFile = [];

    /** folder_id => viewer's personal ['colour'=>?, 'iconName'=>?] preference (user-type folders only) */
    private array $prefRows = [];

    /** id => Folder, all non-trashed folders, lazily loaded once for path-building. */
    private ?array $folderIndex = null;

    /**
     * The firm-wide default grant, resolved once. `false` means "not looked up
     * yet" — null is a real answer here (the setting can be off).
     *
     * @var array{label: string, role: ?string}|null|false
     */
    private array|null|false $orgDefault = false;

    public function __construct(private User $viewer) {}

    /**
     * @param  FileItem[]  $files
     * @param  Folder[]  $folders
     */
    public function prime(array $files, array $folders): void
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
        $this->sharedFolder = $this->sharedWithMap('folder', $folderIds);
        $this->prefRows = FolderColours::preferenceRows($this->viewer, $folderIds);
    }

    public function file(FileItem $file): array
    {
        $ext = (string) $file->extension;
        $sharedWith = $this->sharedFile[$file->id]
            ?? $this->sharedWithMap('file', [$file->id])[$file->id]
            ?? [];
        $assignees = array_column($sharedWith, 'name');
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
            'folder' => $file->folder ? ['id' => $file->folder->uuid, 'name' => $file->folder->name] : null,
            'path' => $this->folderPath($file->folder),
            'createdAt' => optional($file->created_at)->toIso8601String(),
            'uploadedAt' => optional($file->created_at)->toIso8601String(),
            'modifiedAt' => optional($file->source_modified_at ?? $file->updated_at)->toIso8601String(),
            'updatedAt' => optional($file->updated_at)->toIso8601String(),
            'deletedAt' => optional($file->deleted_at)->toIso8601String(),
            'owner' => $this->person($file->owner),
            'uploadedBy' => $this->person($file->uploader),
            // Everyone on the file, owner first — what the Owner column draws
            // as faces. `assignedTo` stays the bare names it has always been.
            'people' => $this->peopleOn($file->owner, $sharedWith),
            'audience' => $this->audienceFor($file->folder),
            'assignedTo' => $assignees,
            'shared' => count($assignees) > 0,
            'favorite' => isset($this->favFile[$file->id]),
            /*
             * One badge, from whichever of the two systems applies.
             *
             * A client document's own review state wins: it is set the moment
             * the file lands, it is what the client's Documents tab is about,
             * and a file showing "Pending review" beside "Awaiting approval"
             * would be two statuses for one document with no way to tell which
             * governs. The approval-workflow badge still shows for everything
             * else, and both remain visible in full inside the viewer.
             */
            'status' => ReviewStatus::badge($file->review_status)
                ?? ($this->statusFile[$file->id] ?? null),
            'review' => [
                'status' => $file->review_status,
                'label' => ReviewStatus::label($file->review_status),
                'note' => $file->review_note,
                'reviewedAt' => optional($file->reviewed_at)->toIso8601String(),
                'reviewedBy' => $file->reviewed_by ? $this->person($file->reviewer) : null,
                // What this viewer may move it to from here.
                'canReview' => $perms['review'],
                // Every state, so the picker can list them all — the current
                // one included, marked rather than missing.
                'all' => ReviewStatus::ALL,
                'next' => ReviewStatus::next($file->review_status),
            ],
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
        $sharedWith = $this->sharedFolder[$folder->id]
            ?? $this->sharedWithMap('folder', [$folder->id])[$folder->id]
            ?? [];
        $assignees = array_column($sharedWith, 'name');

        $stats = $withStats ? FolderTree::aggregate($folder) : ['fileCount' => null, 'folderCount' => null, 'size' => null];

        return [
            'id' => $folder->uuid,
            'type' => 'folder',
            'name' => $folder->name,
            'folderType' => $folder->folder_type,
            'colour' => $this->effectiveColour($folder),
            'iconName' => $this->effectiveIcon($folder),
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
            'people' => $this->peopleOn($folder->owner, $sharedWith),
            // From the folder itself: a folder granted to all staff is shared
            // with them, not merely sitting inside something that is.
            'audience' => $this->audienceFor($folder),
            'assignedTo' => $assignees,
            'shared' => count($assignees) > 0,
            'favorite' => isset($this->favFolder[$folder->id]),
            'permissions' => $this->folderPerms($folder),
        ];
    }

    /**
     * Full ancestor chain for a folder, root-first, including the folder
     * itself — e.g. for `file()`, pass the file's direct folder and get back
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

        $index = $this->folderIndex();
        $trail = [];
        $seen = [];
        $node = $folder;

        while ($node && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            array_unshift($trail, ['id' => $node->uuid, 'name' => $node->name]);
            $node = $node->parent_id ? ($index[$node->parent_id] ?? null) : null;
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
     * fact, no individual shares at all — so a column that only listed
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

        $index = $this->folderIndex();
        $seen = [];
        $node = $folder;
        $top = $folder;
        $explicit = null;

        while ($node && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            $top = $node;

            if ($node->folder_type === Folder::TYPE_CLIENT) {
                // Named people would be the staff assigned to that client, and
                // the assignment is the grant — so that is what it says.
                return ['label' => 'Assigned staff', 'role' => null];
            }

            if ($explicit === null
                && $node->folder_type === Folder::TYPE_ORGANIZATION
                && $node->audience === 'all_staff') {
                $explicit = ['label' => 'All staff', 'role' => ucfirst((string) ($node->audience_role ?: 'viewer'))];
            }

            $node = $node->parent_id ? ($index[$node->parent_id] ?? null) : null;
        }

        // A personal drive is nobody else's, whatever the firm-wide default
        // says — FileAccess stops at the same place, before even the
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

    /** @return array{label: string, role: ?string}|null */
    private function orgDefault(): ?array
    {
        if ($this->orgDefault === false) {
            $this->orgDefault = FileLibrarySetting::defaultOrgAccess()
                ? ['label' => 'All staff', 'role' => ucfirst((string) FileLibrarySetting::defaultOrgRole())]
                : null;
        }

        return $this->orgDefault;
    }

    private function folderIndex(): array
    {
        if ($this->folderIndex === null) {
            $this->folderIndex = Folder::query()
                // folder_type/audience come along for audienceFor(), which
                // walks this same chain to work out who a file is shared with.
                ->select('id', 'uuid', 'name', 'parent_id', 'folder_type', 'audience', 'audience_role')
                ->get()->keyBy('id')->all();
        }

        return $this->folderIndex;
    }

    /**
     * Default/system folders show the one admin-set colour/icon. Regular
     * user folders show the viewer's own preference — primed in bulk by
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

        $row = FolderColourPreference::where('user_id', $this->viewer->id)
            ->where('folder_id', $folder->id)->first(['colour', 'icon_name']);

        $resolved = ['colour' => $row?->colour, 'iconName' => $row?->icon_name];
        $this->prefRows[$folder->id] = $resolved;

        return $resolved;
    }

    private function filePerms(FileItem $file): array
    {
        return [
            'preview' => FileAccess::can($this->viewer, 'preview', $file),
            'download' => FileAccess::can($this->viewer, 'download', $file),
            'rename' => FileAccess::can($this->viewer, 'rename', $file),
            'move' => FileAccess::can($this->viewer, 'move', $file),
            'copy' => FileAccess::can($this->viewer, 'copy', $file),
            'delete' => FileAccess::can($this->viewer, 'delete', $file),
            'share' => FileAccess::can($this->viewer, 'share', $file),
            'assign' => FileAccess::can($this->viewer, 'assign', $file),
            // Reviewing takes the same bar as adding a version: a client who
            // can see their own folder must not be able to approve their own
            // passport. Computed here with the rest so the review block below
            // costs no extra permission checks.
            'review' => FileAccess::can($this->viewer, 'upload', $file),
        ];
    }

    private function folderPerms(Folder $folder): array
    {
        return [
            'upload' => FileAccess::can($this->viewer, 'upload', $folder),
            'download' => FileAccess::can($this->viewer, 'download', $folder),
            'rename' => FileAccess::can($this->viewer, 'rename', $folder),
            'move' => FileAccess::can($this->viewer, 'move', $folder),
            'copy' => FileAccess::can($this->viewer, 'copy', $folder),
            'delete' => FileAccess::can($this->viewer, 'delete', $folder),
            'share' => FileAccess::can($this->viewer, 'share', $folder),
            'assign' => FileAccess::can($this->viewer, 'assign', $folder),
            // Regular folders: anyone who can see it may set their own colour/icon.
            // Default/system folders: admin-only, since it's shared.
            'colour' => $folder->folder_type === Folder::TYPE_USER
                ? FileAccess::can($this->viewer, 'view', $folder)
                : FileAccess::isAdmin($this->viewer),
            'icon' => $folder->folder_type === Folder::TYPE_USER
                ? FileAccess::can($this->viewer, 'view', $folder)
                : FileAccess::isAdmin($this->viewer),
        ];
    }

    private function person(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            // The id is what decides whether the person card's Message and
            // call buttons work at all — without it they are drawn disabled.
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
     * bare names it always did — the Sharing column and the details panel read
     * it — so this is additional rather than a change of shape.
     *
     * @param  array<int, int>  $ids
     * @return array<int, array<int, array<string, mixed>>>
     */
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
     * The owner is a person on the record like any other — they are simply the
     * one who is always there — so the column reads as one answer to "who has
     * this" rather than an owner plus a separate sharing fact. A person shared
     * with who also owns it appears once, with both roles.
     *
     * @param  array<int, array<string, mixed>>  $sharedWith
     * @return array<int, array<string, mixed>>
     */
    private function peopleOn(?User $owner, array $sharedWith): array
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

        return $people;
    }

    /**
     * The review state of many files, in one query.
     *
     * Derived from the workflows rather than stored on the file. A column
     * would be a second answer to a question the workflow tables already
     * answer, and the two would part company the first time a request was
     * cancelled, expired or superseded — leaving a row reading "Approved"
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
            // let a later *open* request replace a settled one — the same
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
