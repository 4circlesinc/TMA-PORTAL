<?php

namespace App\Support\Microsoft;

use App\Models\ConnectedAccount;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * One in-flight Graph call per Outlook mailbox.
 *
 * Graph's MailboxConcurrency limit is four. Calendar sync, mail sync and
 * sender-photo lookups used to hit the same mailbox from different workers
 * at once; file-cache WithoutOverlapping does not span Laravel Cloud
 * replicas, so the stampede still 429'd. A Postgres advisory lock is
 * visible to every worker that shares the database.
 */
final class MailboxGate
{
    private const WAIT_SECONDS = 25;

    private const LOCK_SECONDS = 40;

    /** @var array<int, int> */
    private static array $depth = [];

    /** @var array<int, Lock> */
    private static array $cacheLocks = [];

    public static function bind(PendingRequest $request, ConnectedAccount $account): PendingRequest
    {
        if ($account->provider !== 'microsoft') {
            return $request;
        }

        return $request->withMiddleware(function (callable $handler) use ($account) {
            return function ($psrRequest, array $options) use ($handler, $account) {
                self::acquire($account);

                try {
                    $result = $handler($psrRequest, $options);
                } catch (\Throwable $e) {
                    self::release($account);

                    throw $e;
                }

                if ($result instanceof PromiseInterface) {
                    return $result->then(
                        function ($value) use ($account) {
                            self::release($account);

                            return $value;
                        },
                        function ($reason) use ($account) {
                            self::release($account);

                            return Create::rejectionFor($reason);
                        }
                    );
                }

                self::release($account);

                return $result;
            };
        });
    }

    public static function acquire(ConnectedAccount $account): void
    {
        $id = (int) $account->id;
        self::$depth[$id] = (self::$depth[$id] ?? 0) + 1;
        if (self::$depth[$id] > 1) {
            return;
        }

        $deadline = microtime(true) + self::WAIT_SECONDS;

        while (microtime(true) < $deadline) {
            if (self::tryLock($account)) {
                return;
            }
            usleep(150_000);
        }

        self::$depth[$id]--;

        throw new MailboxBusyException(self::WAIT_SECONDS);
    }

    public static function release(ConnectedAccount $account): void
    {
        $id = (int) $account->id;
        if ((self::$depth[$id] ?? 0) < 1) {
            return;
        }

        self::$depth[$id]--;
        if (self::$depth[$id] > 0) {
            return;
        }

        self::unlock($account);
    }

    private static function tryLock(ConnectedAccount $account): bool
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $row = DB::selectOne('SELECT pg_try_advisory_lock(?) AS locked', [self::advisoryKey($account)]);

            return (bool) ($row->locked ?? false);
        }

        $lock = Cache::lock('ms-graph-mailbox:'.$account->id, self::LOCK_SECONDS);
        if ($lock->get()) {
            self::$cacheLocks[$account->id] = $lock;

            return true;
        }

        return false;
    }

    private static function unlock(ConnectedAccount $account): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_unlock(?)', [self::advisoryKey($account)]);

            return;
        }

        $lock = self::$cacheLocks[$account->id] ?? null;
        $lock?->release();
        unset(self::$cacheLocks[$account->id]);
    }

    private static function advisoryKey(ConnectedAccount $account): int
    {
        $unsigned = crc32('tma-ms-mbx-'.$account->id);

        return $unsigned > 0x7FFFFFFF ? $unsigned - 0x100000000 : $unsigned;
    }
}
