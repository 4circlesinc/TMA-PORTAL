<?php

namespace App\Support\Cip;

use App\Models\Group;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * The CIP Distribution Group and extra mailboxes (§22).
 *
 * Membership lives on the People group of this name so the existing
 * Distribution groups screen is the editor for who is on it. Extra addresses
 * cover mailboxes that are not portal accounts, stored in portal_settings so
 * they are not env-only.
 */
class Distribution
{
    public const KEY = 'cip.distribution';

    public const DEFAULT_GROUP = 'CIP Distribution Group';

    private static ?array $memo = null;

    public static function groupName(): string
    {
        $name = trim((string) config('cip.distribution_group', self::DEFAULT_GROUP));

        return $name !== '' ? $name : self::DEFAULT_GROUP;
    }

    public static function group(): ?Group
    {
        $name = self::groupName();

        return Group::query()
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->where('is_archived', false)
            ->first();
    }

    /** Create the named group if nobody has yet. Safe to call again. */
    public static function ensure(?User $actor = null): Group
    {
        $existing = self::group();

        if ($existing) {
            return $existing;
        }

        return Group::create([
            'uuid' => (string) Str::uuid(),
            'name' => self::groupName(),
            'group_type' => Group::TYPE_TEAM,
            'created_by' => $actor?->id,
        ]);
    }

    /**
     * Extra mailboxes that are not portal accounts.
     *
     * A saved settings row is the source of truth. Until one exists, the
     * env list in config is used, so a firm that never opens the editor
     * keeps the addresses they already had.
     *
     * @return list<string>
     */
    public static function extraEmails(): array
    {
        $stored = self::stored();
        $raw = array_key_exists('emails', $stored)
            ? $stored['emails']
            : config('cip.distribution_emails', []);

        return self::cleanEmails(is_array($raw) ? $raw : []);
    }

    /**
     * @param  list<string>  $emails
     * @return list<string>
     */
    public static function putExtraEmails(array $emails, ?int $userId = null): array
    {
        $clean = self::cleanEmails($emails);

        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            [
                'value' => json_encode(['emails' => $clean]),
                'updated_at' => now(),
                'updated_by' => $userId,
            ],
        );

        self::flush();

        return $clean;
    }

    public static function flush(): void
    {
        self::$memo = null;
        Cache::forget('portal-settings.'.self::KEY);
    }

    /**
     * @param  list<mixed>  $emails
     * @return list<string>
     */
    private static function cleanEmails(array $emails): array
    {
        $clean = [];

        foreach ($emails as $email) {
            $email = trim((string) $email);

            if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }

            $clean[mb_strtolower($email)] = $email;
        }

        return array_values($clean);
    }

    /** @return array<string, mixed> */
    private static function stored(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        try {
            $stored = Cache::remember('portal-settings.'.self::KEY, 60, function () {
                $row = DB::table('portal_settings')->where('key', self::KEY)->first();

                return $row ? (json_decode($row->value, true) ?: []) : [];
            });
        } catch (Throwable) {
            return [];
        }

        return self::$memo = is_array($stored) ? $stored : [];
    }
}
