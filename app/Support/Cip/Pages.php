<?php

namespace App\Support\Cip;

/**
 * Public paths for the CIP workspace.
 *
 * The module used to live at /clients, the hub's old name, so a citizenship
 * file opened as clients/chen-wei?tab=info. The page is the application; the
 * address says so. /clients still serves the same shell for old links.
 */
final class Pages
{
    public const HOME = '/citizenship-applications';

    public static function home(string $query = ''): string
    {
        return $query === '' ? self::HOME : self::HOME.'?'.$query;
    }

    public static function application(string $clientUid, string $query = ''): string
    {
        $path = self::HOME.'/'.$clientUid;

        return $query === '' ? $path : $path.'?'.$query;
    }
}
