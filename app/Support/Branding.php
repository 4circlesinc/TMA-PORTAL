<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The company name, page title, logo and colours every account sees.
 *
 * Edited in Account settings → Account and Reporting → Edit Company Branding,
 * stored in `portal_settings` beside the security policies (see
 * {@see SecurityPolicies}) rather than per browser — branding that only
 * applied to the administrator who typed it was the whole problem with the
 * previous localStorage version.
 *
 * The logo lives on the avatar disk and is served through the app, so a
 * private bucket stays private; `logo` on the record is always an app URL,
 * never a bucket URL.
 */
final class Branding
{
    private const KEY = 'branding';

    private const CACHE_KEY = 'portal-settings.branding';

    /**
     * How long a read stays warm.
     *
     * Deliberately short. Unlike the security policies next door, branding is
     * read on *every* shell boot by every account, so it is nearly always being
     * read while it is being written: a reader that loaded the old row just
     * before a save can write it into the cache just after the save cleared it,
     * and the firm — including the administrator who pressed Save — then keeps
     * seeing the old branding until the entry expires. Writes refresh the entry
     * rather than only dropping it (see put()), and this bounds how long a lost
     * race can survive.
     */
    private const TTL_SECONDS = 30;

    /** Where an uploaded logo is written on the configured disk. */
    public const LOGO_DIRECTORY = 'branding';

    public const DEFAULTS = [
        'accountName' => 'TM ANTOINE Advisory',
        'pageTitle' => 'TM ANTOINE Advisory - Where Companies Connect',
        'headerColor' => '#FFFFFF',
        'accentColor' => '#0C0C0C',
        'logo' => null,
        'logoName' => null,
    ];

    public static function get(): array
    {
        $stored = Cache::remember(self::CACHE_KEY, self::TTL_SECONDS, fn () => self::read());

        return array_replace(self::DEFAULTS, is_array($stored) ? $stored : []);
    }

    /** Merge a partial edit over what is stored. */
    public static function put(array $values, ?int $userId = null): array
    {
        // Read straight through, not through the cache: merging an edit over a
        // possibly stale copy would resurrect whatever it was stale about.
        $merged = array_replace(
            self::DEFAULTS,
            self::read(),
            array_intersect_key($values, self::DEFAULTS),
        );

        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            ['value' => json_encode($merged), 'updated_at' => now(), 'updated_by' => $userId],
        );

        // Refresh rather than invalidate, so a concurrent reader that is about
        // to cache the pre-save row has already been overtaken.
        Cache::put(self::CACHE_KEY, $merged, self::TTL_SECONDS);

        return $merged;
    }

    /** What is actually in the table, with no cache in front of it. */
    private static function read(): array
    {
        $row = DB::table('portal_settings')->where('key', self::KEY)->first();
        $stored = $row ? json_decode($row->value, true) : [];

        return is_array($stored) ? $stored : [];
    }

    /**
     * Put the appearance back to the portal's own look.
     *
     * The account *name* is deliberately not reset — "Use Portal Defaults"
     * sits under Edit Account Appearance, and wiping the firm's name from an
     * appearance button would be a nasty surprise.
     */
    public static function reset(?int $userId = null): array
    {
        self::deleteLogo(self::get()['logo'] ?? null);

        return self::put([
            'pageTitle' => self::DEFAULTS['pageTitle'],
            'headerColor' => self::DEFAULTS['headerColor'],
            'accentColor' => self::DEFAULTS['accentColor'],
            'logo' => null,
            'logoName' => null,
        ], $userId);
    }

    /** Remove a logo we stored ourselves. Leaves anything else alone. */
    public static function deleteLogo(?string $url): void
    {
        if (! $url) {
            return;
        }

        $path = parse_url($url, PHP_URL_PATH) ?: '';
        if (preg_match('#(?:^|/)('.self::LOGO_DIRECTORY.'/[A-Za-z0-9-]+\.[a-z]{3,4})$#', $path, $m)) {
            Storage::disk(self::disk())->delete($m[1]);
        }
    }

    public static function disk(): string
    {
        return config('filesystems.avatar_disk', 'public');
    }
}
