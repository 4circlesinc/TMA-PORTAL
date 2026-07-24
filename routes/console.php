<?php

use App\Jobs\RefreshIcsSubscription;
use App\Jobs\SyncMailbox;
use App\Jobs\SyncProviderCalendar;
use App\Models\Calendar;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Support\Files\ChunkedUpload;
use App\Support\Messaging\OrganizationChat;
use App\Support\Messaging\Thumbnailer;
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
    $removed = Thumbnailer::pruneStaged($hours);

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
    $chat = OrganizationChat::ensure(
        User::where('account_type', 'Administrator')->orderBy('id')->first()
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

/*
 * Wake snoozed messages that are due: clear the snooze (which returns the
 * message to its real folder — the listing hides rows with a snooze set) and
 * raise the reminder notification. This is what makes snooze a *reminder*
 * rather than just a hiding place; the toast/bell side is the ordinary
 * notification pipeline.
 */
Artisan::command('mail:wake-snoozed', function () {
    $due = \App\Models\MailMessage::query()
        ->whereNotNull('snoozed_until')
        ->where('snoozed_until', '<=', now())
        ->orderBy('snoozed_until')
        ->limit(200)
        ->get();

    foreach ($due as $message) {
        $message->forceFill(['snoozed_until' => null])->save();

        \App\Support\Notifications\Notifier::send([
            'user' => $message->user_id,
            'type' => 'email.snooze_due',
            'title' => 'Reminder: '.($message->subject ?: 'a snoozed email'),
            'message' => trim('From '.($message->from_name ?: $message->from_email ?: 'unknown sender').' — back in your '.$message->folder),
            // Deep-link so the toast / panel click opens this exact message.
            'action_url' => '/email?message='.$message->uuid,
            'subject' => $message,
            'image' => \App\Models\MailSenderPhoto::urlFor((string) ($message->from_email ?? '')),
            'metadata' => [
                'from_email' => mb_strtolower((string) ($message->from_email ?? '')),
                'from_name' => (string) ($message->from_name ?: $message->from_email ?: 'Sender'),
            ],
            // One reminder per snooze; re-snoozing later makes a new key window.
            'dedupe_key' => 'email.snooze_due:'.$message->id,
            'dedupe_minutes' => 5,
        ]);
    }

    $this->info("Woke {$due->count()} snoozed message(s).");
})->purpose('Wake due snoozed messages and send their reminder notifications');

// Minute granularity matches the snooze presets (the shortest is an hour) and
// the picker's datetime input, which has minute resolution itself.
Schedule::command('mail:wake-snoozed')
    ->everyMinute()
    ->withoutOverlapping();

/*
 * Re-fetch subscribed ICS calendars that are due.
 *
 * "Due" is per calendar: each carries its own refresh frequency, so an hourly
 * feed and a daily one both get what they asked for from the same tick. A
 * subscription that has failed repeatedly is marked disabled by the job and
 * drops out of this query, so a dead URL stops being retried forever.
 */
Artisan::command('calendar:refresh-subscriptions', function () {
    $due = Calendar::query()
        ->where('source', Calendar::SOURCE_ICS_SUBSCRIPTION)
        ->whereNotNull('subscription_url')
        ->whereNotNull('subscription_frequency')
        ->where(function ($q) {
            $q->whereNull('subscription_status')
                ->orWhereNotIn('subscription_status', ['disabled', 'syncing']);
        })
        ->where(function ($q) {
            $q->whereNull('subscription_synced_at')
                ->orWhereRaw('subscription_synced_at < ?', [now()->subMinutes(1)]);
        })
        ->get()
        // The frequency comparison is done here rather than in SQL because it
        // is per row, and the set is small.
        ->filter(fn (Calendar $c) => $c->subscription_synced_at === null
            || $c->subscription_synced_at->addMinutes((int) $c->subscription_frequency)->isPast());

    foreach ($due as $calendar) {
        RefreshIcsSubscription::dispatch($calendar->id);
    }

    $this->info("Queued refresh for {$due->count()} subscription(s).");
})->purpose('Queue a refresh for every ICS subscription that is due');

Schedule::command('calendar:refresh-subscriptions')
    ->everyFifteenMinutes()
    ->withoutOverlapping();

/*
 * Pull every connected provider calendar up to date.
 *
 * Runs on the same principle as mail:sync-all — a calendar nobody has open
 * still needs to receive, so the timer covers it. The job drops overlapping
 * runs per calendar, and a calendar in a failed/backing-off state is skipped
 * until a manual sync clears it.
 */
Artisan::command('calendar:sync-providers', function () {
    $calendars = Calendar::query()
        ->whereIn('source', [Calendar::SOURCE_GOOGLE, Calendar::SOURCE_MICROSOFT])
        ->whereNotNull('connected_account_id')
        ->where(function ($q) {
            $q->whereNull('subscription_status')
                ->orWhereNotIn('subscription_status', ['syncing']);
        })
        ->where('subscription_failures', '<', 10)
        ->get();

    foreach ($calendars as $calendar) {
        SyncProviderCalendar::dispatch($calendar->id);
    }

    $this->info("Queued sync for {$calendars->count()} provider calendar(s).");
})->purpose('Queue an incremental sync for every connected provider calendar');

Schedule::command('calendar:sync-providers')
    ->everyTenMinutes()
    ->withoutOverlapping();
