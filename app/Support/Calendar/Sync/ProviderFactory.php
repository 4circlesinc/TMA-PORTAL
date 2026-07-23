<?php

namespace App\Support\Calendar\Sync;

use App\Models\ConnectedAccount;

/**
 * Picks the provider implementation for an account.
 *
 * A single seam so the synchronizer, the connect flow and the tests all
 * resolve a provider the same way — and so a test can swap in a fake with one
 * override instead of mocking HTTP in every case.
 */
class ProviderFactory
{
    /** @var callable|null */
    private static $override = null;

    public static function for(ConnectedAccount $account): CalendarProvider
    {
        if (self::$override) {
            return (self::$override)($account);
        }

        return match ($account->provider) {
            'google' => GoogleCalendarProvider::for($account),
            'microsoft' => MicrosoftCalendarProvider::for($account),
            default => throw new CalendarSyncException("No calendar provider for {$account->provider}."),
        };
    }

    /** Tests only: force every resolution to return a fake. */
    public static function fake(callable $factory): void
    {
        self::$override = $factory;
    }

    public static function clearFake(): void
    {
        self::$override = null;
    }
}
