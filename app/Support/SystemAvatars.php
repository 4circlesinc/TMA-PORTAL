<?php

namespace App\Support;

/**
 * The design system's own avatar set (public/images/avatars/*.png).
 * Single source of truth: profile setup, the admin user panel, and
 * validation all read the list from here.
 */
class SystemAvatars
{
    public const ALL = [
        'AvatarDefault',
        'AvatarMale01', 'AvatarMale02', 'AvatarMale03', 'AvatarMale04', 'AvatarMale05', 'AvatarMale06',
        'AvatarFemale01', 'AvatarFemale02', 'AvatarFemale03', 'AvatarFemale04', 'AvatarFemale05', 'AvatarFemale06',
        'AvatarAbstract01', 'AvatarAbstract02', 'AvatarAbstract03', 'AvatarAbstract04',
        'Avatar3d01', 'Avatar3d02', 'Avatar3d03', 'Avatar3d04',
        'AvatarNophoto',
    ];

    /** A stable placeholder for accounts that never chose one. */
    public static function fallbackFor(int $userId): string
    {
        $pool = ['AvatarMale01', 'AvatarFemale01', 'AvatarMale03', 'AvatarFemale04', 'AvatarFemale06'];

        return $pool[$userId % count($pool)];
    }
}
