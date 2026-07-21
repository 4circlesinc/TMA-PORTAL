<?php

use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Support\Files\ChunkedUpload;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Remove abandoned/expired chunked-upload sessions and their orphaned temp
 * parts so half-finished uploads never linger as junk on disk or in the table.
 */
Artisan::command('files:cleanup-uploads', function () {
    $removed = ChunkedUpload::cleanupExpired();
    $this->info("Removed {$removed} expired upload session(s).");
})->purpose('Clean up expired file-upload sessions');

Schedule::command('files:cleanup-uploads')->hourly();

/*
 * Pull every connected mailbox on a timer.
 *
 * Sync used to be dispatched only when someone opened the email page, so a
 * mailbox nobody was looking at simply did not receive — mail sat at the
 * provider until the next visit, and the arrival gaps that produced looked
 * exactly like messages going missing.
 */
Artisan::command('mail:sync-all', function () {
    $accounts = ConnectedAccount::query()
        ->where('sync_email', true)
        ->whereNotNull('token')
        ->get();

    foreach ($accounts as $account) {
        SyncMailbox::dispatch($account);
    }

    $this->info("Queued sync for {$accounts->count()} mailbox(es).");
})->purpose('Queue an incremental sync for every connected mailbox');

// Every minute is the floor cron can offer. It covers the mailbox nobody is
// looking at; the email page itself polls every five seconds while open (see
// MAIL_POLL_INTERVAL / MailSynchronizer::quickCheck), which is what makes it
// feel live. Sub-minute delivery with no page open needs provider push —
// Graph change notifications or Gmail Pub/Sub — not a tighter timer.
Schedule::command('mail:sync-all')
    ->everyMinute()
    // The job already drops overlapping runs per mailbox; this stops a slow
    // provider from stacking scheduler ticks on top of each other as well.
    ->withoutOverlapping();
