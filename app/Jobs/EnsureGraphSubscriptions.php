<?php

namespace App\Jobs;

use App\Support\Microsoft\ChangeNotifications;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Create or renew Graph change-notification subscriptions.
 *
 * The handshake with Graph is a few small POSTs; this exists so a connect
 * that happens while APP_URL is not yet public (a first deploy) still gets
 * push once HTTPS is up, without blocking the connect itself.
 */
class EnsureGraphSubscriptions implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 120;

    public int $uniqueFor = 180;

    public function uniqueId(): string
    {
        return 'graph-subscriptions';
    }

    public function handle(): void
    {
        ChangeNotifications::ensureAll();
    }
}
