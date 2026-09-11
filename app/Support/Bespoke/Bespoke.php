<?php

namespace App\Support\Bespoke;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;

/**
 * Whether Bespoke AI exists in this environment, and who may use it.
 *
 * The flag is the whole surface: while FEATURE_BESPOKE is off the module
 * does not exist for anyone, administrators included. Routes 404 rather
 * than 403 so nobody can learn it is there. Every signed-in portal account
 * may use it once it is on — there is no extra account type.
 */
final class Bespoke
{
    public static function enabled(): bool
    {
        return (bool) config('services.bespoke.enabled');
    }

    public static function configured(): bool
    {
        $key = config('services.bespoke.key');

        return is_string($key) && trim($key) !== '';
    }

    public static function abortUnlessEnabled(): void
    {
        abort_unless(self::enabled(), 404);
    }

    /**
     * Facts the model (and the local FAQ) may rely on. Role always comes
     * from the session, never from the browser.
     *
     * @return array{
     *     accountType: string,
     *     isAdmin: bool,
     *     isStaff: bool,
     *     isClient: bool,
     *     isProviderContact: bool,
     *     cipEnabled: bool,
     *     cipReach: bool,
     *     capabilities: list<string>,
     *     locale: string,
     *     theme: string
     * }
     */
    public static function identity(User $user): array
    {
        $prefs = is_array($user->preferences) ? $user->preferences : [];

        return [
            'accountType' => (string) (Role::of($user) ?: $user->account_type ?: 'Client'),
            'isAdmin' => Role::isAdmin($user),
            'isStaff' => Role::isStaff($user),
            'isClient' => Role::isClient($user),
            'isProviderContact' => CipAccess::isProviderContact($user),
            'cipEnabled' => CipAccess::enabled(),
            'cipReach' => CipAccess::canReach($user),
            'capabilities' => Role::capabilities($user),
            'locale' => is_string($prefs['language'] ?? null) ? $prefs['language'] : 'auto',
            'theme' => is_string($prefs['themeMode'] ?? null) ? $prefs['themeMode'] : 'light',
        ];
    }

    public static function can(User $user, string $capability): bool
    {
        if ($capability === 'clients.view' && CipAccess::canReach($user)) {
            return true;
        }

        if ($capability === 'overview.view' && CipAccess::isProviderContact($user)) {
            return true;
        }

        if ($capability === 'workflows.view' && CipAccess::isProviderContact($user)) {
            return true;
        }

        return Role::can($user, $capability);
    }
}
