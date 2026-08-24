<?php

namespace App\Support\Realtime;

use App\Events\PortalDataChanged;
use Illuminate\Broadcasting\PrivateChannel;
use Throwable;

/**
 * The one place a write says "tell the open tabs to refetch this".
 *
 * Nothing is sent while the request is running. Calls are collected and
 * flushed once, at the end, because these fire per *row*: emptying the recycle
 * bin, a bulk share, or a SharePoint delta that lands ten thousand files would
 * otherwise make ten thousand blocking HTTP calls to Reverb from inside one
 * request. Coalescing makes a bulk operation cost exactly what a single-row
 * one does, one event per resource, and the browser cannot tell the
 * difference, since it refetches the whole list either way.
 *
 * Reach is decided here rather than at each call site, and the payload carries
 * no rows at all; see {@see PortalDataChanged} for why.
 *
 * Broadcasting is best-effort. A portal that cannot reach Reverb must still
 * accept writes, so failures are swallowed and the surface falls back to the
 * behaviour it has always had, updating on the next load.
 */
final class Live
{
    /* Shared with TMALive.RESOURCES in public/js/portal-live.js, a name that
       exists on only one side is a surface that silently never updates. */
    public const FILES = 'files';

    public const CLIENTS = 'clients';

    public const USERS = 'users';

    public const CONTACTS = 'contacts';

    public const CALENDAR = 'calendar';

    public const COMPANIES = 'companies';

    public const PROJECTS = 'projects';

    public const SIGNATURES = 'signatures';

    public const ACTIVITY = 'activity';

    /**
     * "Who you are changed", account type, status, approval.
     *
     * Goes to the affected person's own channel, never a shared one. It is the
     * one signal that is about the reader rather than about a list they happen
     * to be looking at.
     */
    /** CIP applications, the intake wizard and the module's lists. */
    public const CIP = 'cip';

    public const IDENTITY = 'identity';

    /** resource => channel name => PrivateChannel, built up during the request. */
    private static array $pending = [];

    private static bool $flushRegistered = false;

    /** Everyone on staff, the Users, Clients, People and admin tables. */
    public static function staff(string $resource): void
    {
        self::queue($resource, 'portal.staff');
    }

    /** One person, whatever they happen to have open. */
    public static function user(string $resource, int|string|null $userId): void
    {
        if ($userId !== null) {
            self::queue($resource, 'App.Models.User.'.$userId);
        }
    }

    /**
     * Several people at once, the readers of a shared folder, a client's
     * assigned staff, a company's members.
     *
     * @param  iterable<int, int|string|null>  $userIds
     */
    public static function users(string $resource, iterable $userIds): void
    {
        foreach ($userIds as $userId) {
            self::user($resource, $userId);
        }
    }

    /** Staff plus a specific set of people, the usual reach of a file change. */
    public static function staffAnd(string $resource, iterable $userIds): void
    {
        self::staff($resource);
        self::users($resource, $userIds);
    }

    /**
     * Send everything collected this request.
     *
     * Registered to run on terminate the first time anything is queued, so a
     * request that changes nothing costs nothing. Safe to call directly, in a
     * queued job or console command there is no terminate step, and the caller
     * flushes by hand.
     */
    public static function flush(): void
    {
        $pending = self::$pending;
        self::$pending = [];

        foreach ($pending as $resource => $channels) {
            try {
                // toOthers() drops the actor, who already re-rendered. It only
                // works when the browser sent X-Socket-ID, see the socketId()
                // helper in public/js/portal-live.js.
                broadcast(new PortalDataChanged($resource, array_values($channels)))->toOthers();
            } catch (Throwable) {
                // A portal that can't reach Reverb still has to accept writes.
            }
        }
    }

    private static function queue(string $resource, string $channel): void
    {
        // Keyed by name so the same person named twice in one request is one
        // subscription's worth of work, not two.
        self::$pending[$resource][$channel] ??= new PrivateChannel($channel);

        if (self::$flushRegistered) {
            return;
        }

        self::$flushRegistered = true;

        // Deferring to terminate keeps the broadcast off the response path:
        // Reverb is a blocking HTTP call, and the person who made the change
        // should not wait on notifying everyone else.
        app()->terminating(static function (): void {
            self::$flushRegistered = false;
            self::flush();
        });
    }
}
