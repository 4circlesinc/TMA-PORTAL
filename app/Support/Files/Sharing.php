<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Sharing helpers: secure tokens, the role vocabulary, safe presentation of a
 * share (never leaks the file's storage path or db id), and who may manage it.
 */
class Sharing
{
    public const ROLES = ['viewer', 'downloader', 'editor', 'full'];

    /** A long, unguessable public link token. */
    public static function token(): string
    {
        return Str::random(48);
    }

    public static function normalizeRole(?string $role): string
    {
        return in_array($role, self::ROLES, true) ? $role : 'viewer';
    }

    /** The public link URL for a link share (token only — no path/id). */
    public static function linkUrl(Share $share): ?string
    {
        return $share->kind === 'link' ? url('/s/'.$share->token) : null;
    }

    /** May this user manage (edit/revoke) the share? */
    public static function canManage(User $user, Share $share, FileItem|Folder $item): bool
    {
        return FileAccess::isAdmin($user)
            || $share->shared_by === $user->id
            || $item->owner_id === $user->id;
    }

    /** Safe JSON for a single share. */
    public static function present(Share $share): array
    {
        return [
            'id' => $share->uuid,
            'kind' => $share->kind,
            'role' => $share->role,
            'person' => $share->kind === 'user'
                ? ['name' => $share->targetUser?->name, 'email' => $share->targetUser?->email, 'avatar' => $share->targetUser?->avatar_url]
                : ($share->kind === 'email' ? ['name' => $share->target_email, 'email' => $share->target_email, 'avatar' => null] : null),
            'allowDownload' => (bool) $share->allow_download,
            'hasPassword' => $share->password_hash !== null,
            'expiresAt' => optional($share->expires_at)->toIso8601String(),
            'link' => self::linkUrl($share),
            'createdAt' => optional($share->created_at)->toIso8601String(),
        ];
    }

    public static function verifyPassword(Share $share, ?string $password): bool
    {
        if ($share->password_hash === null) {
            return true;
        }

        return $password !== null && Hash::check($password, $share->password_hash);
    }
}
