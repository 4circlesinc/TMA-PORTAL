<?php

namespace App\Support\Files;

use App\Models\ClientAssignment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Access\Role;

/**
 * "People with access", expressed as the *reasons* people have access rather
 * than as a flat list of everyone.
 *
 * An organization file is readable by every member of staff. Listing them
 * individually would be hundreds of rows that say nothing — and it would go
 * stale the moment someone is hired. So access is reported as sources
 * ("Everyone in TM Antoine Advisory and Partners", "Assigned client team",
 * "Specific people", "Sharing links"), each expandable to its members.
 *
 * This mirrors {@see FileAccess} exactly. It must never claim access that
 * FileAccess would refuse: it reads the same folder chain and the same share
 * rows, and derives the same roles.
 */
class AccessSources
{
    private const ROLE_LABELS = [
        'viewer' => 'Can view',
        'downloader' => 'Can download',
        'editor' => 'Can edit',
        'full' => 'Full access',
    ];

    /** Members listed inline before a source collapses to a count. */
    private const PREVIEW = 8;

    /**
     * @return array{sources: list<array>, canManage: bool}
     */
    public static function forFile(FileItem $file, User $viewer): array
    {
        $sources = [];

        // 1. The owner — always, and never removable from here.
        if ($file->owner) {
            $sources[] = self::source(
                key: 'owner',
                label: 'Owner',
                detail: $file->owner->name,
                role: 'full',
                icon: 'User',
                members: [self::person($file->owner)],
            );
        }

        // 2. Administrators hold every capability by definition (Role::MATRIX),
        //    so they always have access whether or not anything is shared.
        $admins = User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', User::STATUS_APPROVED)
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'avatar_url', 'provider_avatar_url']);

        if ($admins->isNotEmpty()) {
            $sources[] = self::source(
                key: 'administrators',
                label: 'Administrators',
                detail: self::count($admins->count(), 'administrator'),
                role: 'full',
                icon: 'ShieldCheck',
                members: $admins->map(fn (User $u) => self::person($u))->all(),
            );
        }

        // 3. Whatever the containing folder chain grants on its own — the
        //    organization-wide audience, a staff member's private folder, or a
        //    client's team. Walking the chain is what FileAccess does.
        foreach (self::chain($file->folder_id) as $folder) {
            $source = self::folderSource($folder);
            if ($source !== null) {
                $sources[] = $source;
            }
        }

        // 4. The firm-wide default, when it applies to this file. Reported as
        //    one source with a head-count, never as a list of every employee.
        if (self::orgDefaultApplies($file)) {
            $staff = User::query()
                ->whereIn('account_type', Role::STAFF)
                ->where('status', User::STATUS_APPROVED)
                ->orderBy('name')
                ->get(['id', 'name', 'email', 'job_title', 'account_type', 'avatar_url', 'provider_avatar_url']);

            if ($staff->isNotEmpty()) {
                $sources[] = self::source(
                    key: 'organization:default',
                    label: 'Everyone in '.config('app.name', 'the organization'),
                    detail: self::count($staff->count(), 'person', 'people'),
                    role: \App\Models\FileLibrarySetting::defaultOrgRole(),
                    icon: 'Buildings',
                    members: $staff->map(fn (User $u) => self::person($u))->all(),
                    origin: 'Shared with the firm by default',
                );
            }
        }

        // 5. Explicit shares: named people, and links.
        $shares = Share::query()
            ->where('item_type', 'file')
            ->where('item_id', $file->id)
            ->whereNull('revoked_at')
            ->with('targetUser:id,name,email,avatar_url,provider_avatar_url')
            ->get()
            ->filter(fn (Share $s) => $s->isActive());

        $people = $shares->where('kind', 'user')->filter(fn (Share $s) => $s->targetUser !== null);
        if ($people->isNotEmpty()) {
            $sources[] = self::source(
                key: 'specific',
                label: 'Specific people',
                detail: self::count($people->count(), 'person', 'people'),
                role: null,
                icon: 'UsersThree',
                members: $people->map(fn (Share $s) => self::person($s->targetUser, $s->role, $s->uuid))->values()->all(),
            );
        }

        $links = $shares->where('kind', '!=', 'user');
        if ($links->isNotEmpty()) {
            $sources[] = self::source(
                key: 'links',
                label: 'Sharing links',
                detail: self::count($links->count(), 'link'),
                role: null,
                icon: 'LinkSimple',
                members: $links->map(fn (Share $s) => [
                    'name' => 'Anyone with the link',
                    'email' => $s->target_email,
                    'avatar' => null,
                    'role' => self::ROLE_LABELS[$s->role] ?? $s->role,
                    'shareId' => $s->uuid,
                    'expiresAt' => optional($s->expires_at)->toIso8601String(),
                    'passwordProtected' => $s->password_hash !== null,
                ])->values()->all(),
            );
        }

        return [
            'sources' => $sources,
            'canManage' => FileAccess::can($viewer, 'share', $file),
            // The face stack: everyone with access, flattened across sources
            // and de-duplicated, so somebody who is both an administrator and
            // on the client team is one face rather than two.
            'shared' => self::faceStack($sources),
        ];
    }

    /** Faces shown before the stack collapses to "+N". */
    public const FACES = 5;

    /**
     * One flat, de-duplicated roster across every source.
     *
     * The panel leads with this because it answers the question people actually
     * ask — "who can see this?" — in one glance. The grouped sources below it
     * answer the follow-up, "and why?".
     *
     * @return array{faces: list<array>, all: list<array>, total: int, extra: int, summary: string}
     */
    private static function faceStack(array $sources): array
    {
        $byEmail = [];
        $summaryParts = [];

        foreach ($sources as $source) {
            // Sources carry only a preview of their members, so the count has
            // to come from `total`, not from the preview array's length.
            if ($source['total'] > count($source['members'])) {
                $summaryParts[] = $source['label'];
            }

            foreach ($source['members'] as $member) {
                $key = $member['email'] ?? $member['name'] ?? null;
                if ($key === null || isset($byEmail[$key])) {
                    continue;
                }
                $byEmail[$key] = $member + ['via' => $source['label']];
            }
        }

        $people = array_values($byEmail);

        // The true head-count is the widest source, not the number of distinct
        // faces we happened to preview — an org of 200 must not read as "8".
        $total = 0;
        foreach ($sources as $source) {
            $total = max($total, (int) $source['total']);
        }
        $total = max($total, count($people));

        return [
            'faces' => array_slice($people, 0, self::FACES),
            'all' => $people,
            'total' => $total,
            'extra' => max(0, $total - self::FACES),
            'summary' => self::summaryFor($sources, $total),
        ];
    }

    /** "Everyone in TM ANTOINE Advisory · 42 people" — the one-line answer. */
    private static function summaryFor(array $sources, int $total): string
    {
        foreach ($sources as $source) {
            if (str_starts_with($source['key'], 'organization:')) {
                return $source['label'];
            }
        }

        foreach ($sources as $source) {
            if (str_starts_with($source['key'], 'client:')) {
                return 'The assigned client team';
            }
            if (str_starts_with($source['key'], 'staff:')) {
                return $source['label'];
            }
        }

        return $total === 1 ? 'Only you' : $total.' people';
    }

    /** Mirrors FileAccess::organizationDefaultRole — client folders only. */
    private static function orgDefaultApplies(FileItem $file): bool
    {
        if (! \App\Models\FileLibrarySetting::defaultOrgAccess()) {
            return false;
        }

        foreach (self::chain($file->folder_id) as $folder) {
            if ($folder->folder_type === Folder::TYPE_CLIENT) {
                return false;
            }
        }

        return true;
    }

    /**
     * The access a single folder in the chain grants by its own type. Mirrors
     * FileAccess::systemFolderRole — organization folders open to all staff, a
     * staff folder to its subject, a client folder to that client's assignees.
     */
    private static function folderSource(Folder $folder): ?array
    {
        if ($folder->folder_type === Folder::TYPE_ORGANIZATION && $folder->audience === 'all_staff') {
            $staff = User::query()
                ->whereIn('account_type', Role::STAFF)
                ->where('status', User::STATUS_APPROVED)
                ->orderBy('name')
                ->get(['id', 'name', 'email', 'avatar_url', 'provider_avatar_url']);

            return self::source(
                key: 'organization:'.$folder->id,
                label: 'Everyone in '.config('app.name', 'the organization'),
                detail: self::count($staff->count(), 'member'),
                role: $folder->audience_role ?: 'viewer',
                icon: 'Buildings',
                members: $staff->map(fn (User $u) => self::person($u))->all(),
                origin: 'Organization folder “'.$folder->name.'”',
            );
        }

        if ($folder->folder_type === Folder::TYPE_STAFF && $folder->subject) {
            return self::source(
                key: 'staff:'.$folder->id,
                label: 'Private to '.$folder->subject->name,
                detail: 'Personal staff folder',
                role: 'full',
                icon: 'Lock',
                members: [self::person($folder->subject)],
                origin: 'Staff folder “'.$folder->name.'”',
            );
        }

        if ($folder->folder_type === Folder::TYPE_CLIENT && $folder->client_id !== null) {
            $assignments = ClientAssignment::query()
                ->where('client_id', $folder->client_id)
                ->with('user:id,name,email,avatar_url,provider_avatar_url')
                ->get()
                ->filter(fn (ClientAssignment $a) => $a->user !== null);

            if ($assignments->isEmpty()) {
                return null;
            }

            return self::source(
                key: 'client:'.$folder->id,
                label: 'Assigned client team',
                detail: self::count($assignments->count(), 'assigned person', 'assigned people'),
                role: null,
                icon: 'Briefcase',
                members: $assignments->map(fn (ClientAssignment $a) => self::person($a->user, $a->fileRole()))->values()->all(),
                origin: 'Client folder “'.$folder->name.'”',
            );
        }

        return null;
    }

    /** The folder and its ancestors, self first. Cycle-safe, like FileAccess. */
    private static function chain(?int $folderId): array
    {
        $chain = [];
        $seen = [];

        while ($folderId !== null && ! isset($seen[$folderId])) {
            $seen[$folderId] = true;
            $folder = Folder::with(['client:id,name', 'subject:id,name'])->find($folderId);
            if (! $folder) {
                break;
            }
            $chain[] = $folder;
            $folderId = $folder->parent_id;
        }

        return $chain;
    }

    private static function source(
        string $key,
        string $label,
        string $detail,
        ?string $role,
        string $icon,
        array $members,
        ?string $origin = null,
    ): array {
        return [
            'key' => $key,
            'label' => $label,
            'detail' => $detail,
            'role' => $role ? (self::ROLE_LABELS[$role] ?? $role) : null,
            'icon' => $icon,
            'origin' => $origin,
            'total' => count($members),
            // Only a preview travels to the client; the rest arrives when the
            // group is expanded. A firm-wide source would otherwise ship every
            // employee on every file open.
            'members' => array_slice($members, 0, self::PREVIEW),
            'truncated' => count($members) > self::PREVIEW,
        ];
    }

    private static function person(User $user, ?string $role = null, ?string $shareId = null): array
    {
        return array_filter([
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->photoUrl(),
            'jobTitle' => $user->job_title,
            'accountType' => $user->account_type,
            'role' => $role ? (self::ROLE_LABELS[$role] ?? $role) : null,
            'shareId' => $shareId,
        ], fn ($v) => $v !== null);
    }

    private static function count(int $n, string $singular, ?string $plural = null): string
    {
        return $n.' '.($n === 1 ? $singular : ($plural ?: $singular.'s'));
    }
}
