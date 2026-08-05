<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Support\Calendar\CalendarImporter;
use App\Support\Calendar\Sync\CalendarSyncException;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Auto-import after OAuth: the moment calendar sync is (re)enabled, mirror
 * every calendar the account can see so the user's calendar simply works —
 * no "Connect all" click required. Idempotent: already-mirrored calendars
 * are skipped by the importer.
 */
class ImportProviderCalendars implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /** @var int[] */
    public array $backoff = [30, 120, 300];

    public function __construct(public int $accountId)
    {
    }

    public function uniqueId(): string
    {
        return 'import-calendars-'.$this->accountId;
    }

    public function handle(): void
    {
        $account = ConnectedAccount::find($this->accountId);

        if (! $account || ! $account->sync_calendar || ! $account->token || ! $account->canReadCalendar()) {
            return;
        }

        $user = $account->user;
        if (! $user) {
            return;
        }

        try {
            $result = CalendarImporter::importAll($user, $account);

            Log::info('Calendar auto-import finished', [
                'account' => $account->id,
                'found' => $result['found'],
                'added' => count($result['added']),
                'skipped' => $result['skipped'],
                'failed' => count($result['failed']),
            ]);
        } catch (CalendarSyncException $e) {
            // A bad token here fixes itself on the next reconnect; don't burn
            // retries on it.
            Log::warning('Calendar auto-import could not list calendars', [
                'account' => $account->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
