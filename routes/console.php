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
 * Message attachments are uploaded and staged the moment they are chosen, so a
 * composer that is abandoned - tab closed, message never sent - leaves rows
 * with no message and bytes with no owner. This removes both.
 *
 * AttachmentIntake also prunes the *uploader's own* stale rows on every upload,
 * so storage stays bounded even when the scheduler is not running, which has
 * been a recurring problem here. This is the thorough pass.
 */
Artisan::command('messaging:prune-attachments {--hours=24}', function () {
    $hours = max(1, (int) $this->option('hours'));
    $removed = App\Support\Messaging\Thumbnailer::pruneStaged($hours);

    $this->info("Removed {$removed} abandoned attachment(s) older than {$hours}h.");
})->purpose('Remove staged message attachments that were never sent');

Schedule::command('messaging:prune-attachments')->hourly();

/*
 * Create the firm-wide default conversation if it does not exist yet.
 *
 * Membership is not seeded here: OrganizationChat::syncMembership runs when a
 * user loads their conversations, so anyone approved later joins on their next
 * visit rather than needing this to be re-run.
 */
Artisan::command('messaging:org-chat', function () {
    $chat = App\Support\Messaging\OrganizationChat::ensure(
        App\Models\User::where('account_type', 'Administrator')->orderBy('id')->first()
    );

    $this->info("Organization chat ready: \"{$chat->name}\" ({$chat->uuid}).");
    $this->line('Members join automatically the next time they open Messages.');
})->purpose('Create the firm-wide default conversation');

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
