<?php

namespace App\Support\Cache;

use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * A cache read that a request can survive.
 *
 * The cache is an accelerator, never the source of truth: everything stored
 * through here can be recomputed from the database. So when the store is
 * unreachable, a slow TLS handshake to the managed Redis, a connection cap,
 * a store mid-restart, the request must not wait on it and must not fail
 * because of it. `Cache::remember` does both: the client blocks for its read
 * timeout, retries, and then throws, which the browser sees as a gateway
 * timeout on a page whose data was sitting in Postgres the whole time.
 *
 * Only the store calls are guarded. The value closure runs outside the
 * try, so a genuine failure computing the value still surfaces as itself
 * rather than being retried or masked as a cache problem.
 */
final class SoftCache
{
    /** Report a store outage once per process, not once per key. */
    private static bool $reported = false;

    /**
     * @template T
     *
     * @param  \Closure(): T  $compute
     * @return T
     */
    public static function remember(string $key, int $ttlSeconds, \Closure $compute): mixed
    {
        try {
            $hit = Cache::get($key);
        } catch (Throwable $e) {
            self::report($e);

            return $compute();
        }

        if ($hit !== null) {
            return $hit;
        }

        $value = $compute();

        try {
            Cache::put($key, $value, $ttlSeconds);
        } catch (Throwable $e) {
            self::report($e);
        }

        return $value;
    }

    /**
     * Drop a key if the store is reachable. When it is not, nothing was
     * readable from it anyway, and a short TTL bounds any entry that a
     * partial outage leaves behind.
     */
    public static function forget(string $key): void
    {
        try {
            Cache::forget($key);
        } catch (Throwable $e) {
            self::report($e);
        }
    }

    private static function report(Throwable $e): void
    {
        if (self::$reported) {
            return;
        }

        self::$reported = true;
        report($e);
    }

    /** @internal tests */
    public static function reset(): void
    {
        self::$reported = false;
    }
}
