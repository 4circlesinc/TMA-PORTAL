<?php

use App\Jobs\EnsureGraphSubscriptions;
use App\Jobs\PublishScheduledFeedPost;
use App\Jobs\RefreshIcsSubscription;
use App\Jobs\SyncCbiHub;
use App\Jobs\SyncMailbox;
use App\Jobs\SyncProviderCalendar;
use App\Jobs\SyncSmartsheetSheet;
use App\Models\AuthEvent;
use App\Models\Calendar;
use App\Models\ConnectedAccount;
use App\Models\FeedAttachment;
use App\Models\FeedPost;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\MailMessage;
use App\Models\MailSenderPhoto;
use App\Models\Report;
use App\Models\SmartsheetSheet;
use App\Models\User;
use App\Support\Cbi\Mapper;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Delay;
use App\Support\Files\ChunkedUpload;
use App\Support\Files\Presence;
use App\Support\Files\Workflow\Engine;
use App\Support\Files\Workflow\Status;
use App\Support\Imports\ImportPause;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Messaging\OrganizationChat;
use App\Support\Messaging\Thumbnailer;
use App\Support\Notifications\Notifier;
use App\Support\Reports\ReportRunner;
use App\Support\Security\SecurityAlerts;
use App\Support\Smartsheet\Client;
use App\Support\Smartsheet\Synchroniser;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

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
 * Due dates and reminders on file review/approval requests.
 *
 * Both live here rather than in the request path because neither can be driven
 * by a user action: a request expires because time passed, and a reminder is
 * owed precisely when nobody has done anything. Without the scheduler running,
 * requests simply stay open — they never silently resolve themselves.
 */
Artisan::command('files:workflow-maintenance', function () {
    $expired = 0;
    FileWorkflow::query()
        ->whereNotIn('status', Status::TERMINAL)
        ->whereNotNull('due_at')
        ->where('due_at', '<', now())
        ->each(function (FileWorkflow $workflow) use (&$expired) {
            $workflow->update(['status' => Status::EXPIRED, 'completed_at' => now()]);
            Engine::log($workflow, null, 'expired', 'The due date passed.');
            Notifier::send([
                'user' => $workflow->created_by,
                'type' => 'file.approval_decision',
                'title' => $workflow->file->name.' — request expired',
                'subject' => $workflow->file,
            ]);
            $expired++;
        });

    $reminded = 0;
    FileWorkflow::query()
        ->whereNotIn('status', Status::TERMINAL)
        ->whereNotNull('reminder_days')
        ->with('file')
        ->each(function (FileWorkflow $workflow) use (&$reminded) {
            $cutoff = now()->subDays(max(1, (int) $workflow->reminder_days));

            $workflow->steps()
                ->whereIn('status', ['invited'])
                ->whereNotNull('invited_at')
                ->where(function ($q) use ($cutoff) {
                    // Never reminded yet, or last reminded long enough ago.
                    $q->where(function ($w) use ($cutoff) {
                        $w->whereNull('last_reminded_at')->where('invited_at', '<', $cutoff);
                    })->orWhere('last_reminded_at', '<', $cutoff);
                })
                ->each(function (FileWorkflowStep $step) use ($workflow, &$reminded) {
                    if (! $step->user_id) {
                        return;
                    }
                    Notifier::send([
                        'user' => $step->user_id,
                        'actor' => $workflow->sender,
                        'type' => 'file.approval_reminder',
                        'title' => 'Still waiting on you: '.$workflow->file->name,
                        'message' => $workflow->message,
                        'subject' => $workflow->file,
                    ]);
                    $step->update([
                        'last_reminded_at' => now(),
                        'reminder_count' => $step->reminder_count + 1,
                    ]);
                    Engine::log($workflow, null, 'reminded', null, ['step' => $step->uuid]);
                    $reminded++;
                });
        });

    $this->info("Expired {$expired} request(s), sent {$reminded} reminder(s).");
})->purpose('Expire overdue file requests and send approval reminders');

Schedule::command('files:workflow-maintenance')->hourly()->withoutOverlapping(120);

/*
 * CIP delayed applications (§20).
 *
 * If 180 days have passed since the Accepted for processing date and the
 * Unit has recorded no decision, the file is Delayed. Notices go to the
 * Administrator, the Reviewing Officer, and the Service Provider.
 * Idempotent: an already-delayed file is never re-notified. The delay
 * clock starts when acceptance is recorded (§19).
 */
Artisan::command('cip:flag-delayed', function () {
    if (! CipAccess::enabled()) {
        $this->info('CIP is disabled (FEATURE_CIP).');

        return;
    }

    $flagged = Delay::run();
    $this->info("Flagged {$flagged} delayed application(s).");
})->purpose('Mark CIP applications delayed after 180 days with no decision');

Schedule::command('cip:flag-delayed')->dailyAt('04:00')->withoutOverlapping(180);

/*
 * Drop file-presence rows whose tab stopped renewing. Staleness is already
 * derived on read, so this is only about keeping the table small — the roster
 * is correct with or without it.
 */
Artisan::command('files:prune-presence', function () {
    $this->info('Removed '.Presence::prune().' stale presence session(s).');
})->purpose('Remove file presence sessions that stopped sending heartbeats');

Schedule::command('files:prune-presence')->everyThirtyMinutes();

/*
 * Each person's History retention choice (Settings → Privacy). Daily is
 * enough for a window measured in days, and it runs off-peak because it
 * touches every account.
 */
Schedule::command('portal:prune-history')->dailyAt('03:20')->withoutOverlapping(180);

/*
 * Recompute recurring account reports whose next run is due.
 *
 * This is what makes the Reporting page's "recurring" tab mean anything: a
 * recurring report rolls its window forward to end today and re-measures, so
 * opening it a month later shows the month it was asked about rather than the
 * numbers it was created with. A due date in the past is still run — a
 * scheduler that was down must catch up, not skip.
 */
Artisan::command('reports:run {--all : Recompute every recurring report, due or not}', function () {
    $due = Report::query()
        ->whereNotNull('frequency')
        ->when(! $this->option('all'), fn ($q) => $q->where(function ($w) {
            $w->whereNull('next_run_at')->orWhere('next_run_at', '<=', now());
        }))
        ->orderBy('next_run_at')
        ->get();

    foreach ($due as $report) {
        ReportRunner::run(
            ReportRunner::rollWindow($report)
        );
        $this->info("{$report->status}: {$report->name}");
    }

    $this->info('Recomputed '.$due->count().' recurring report(s).');
})->purpose('Recompute recurring account reports that are due');

// Hourly rather than daily: the cadences are weekly and monthly, so this only
// has to be fine enough that a report lands on the right day.
Schedule::command('reports:run')->hourly()->withoutOverlapping(120);

/*
 * Pull every connected SharePoint library on a timer.
 *
 * Without this, sync only ever happens when somebody runs the command by hand —
 * which is exactly how the mailbox ended up looking like it was losing mail.
 * Queued so a large library cannot hold up the scheduler, and non-overlapping
 * because two runs would process the same delta cursor twice.
 *
 * Every withoutOverlapping() in this file carries an explicit expiry. The
 * default is 24 HOURS, and a schedule:run killed mid-command (restarts,
 * deploys) leaks the mutex: this entry and mail:sync-all were silently
 * skipped every minute for most of 2026-09-01 that way, which is why
 * freshly connected personal OneDrives never imported. An expiry of a few
 * cadences makes a leaked mutex cost minutes, not a day.
 */
Schedule::command('sharepoint:sync --queue')
    ->everyMinute()
    ->withoutOverlapping(10);

/*
 * Item-level failures heal themselves. One reset connection or Graph 504
 * marks an item FAILED and nothing else ever returns to it — delta only
 * re-emits changed items. The sweep retries with growing spacing and a
 * cap, so "could not sync" only stays on screen for failures that are real.
 */
Artisan::command('sharepoint:retry-failed', function () {
    \App\Jobs\RetrySharePointFailures::dispatch();
    $this->info('Queued the failed-item retry sweep.');
})->purpose('Retry SharePoint items whose last sync attempt failed');

Schedule::command('sharepoint:retry-failed')
    ->everyTenMinutes()
    ->withoutOverlapping(30);

/*
 * Provider folders in the Citizenship Applications library become CIP
 * service providers on their own, linked to their folder. Idempotent, so
 * an hour with nothing new writes nothing.
 */
Schedule::command('cip:providers-from-folders')->hourly()->withoutOverlapping(120);

/*
 * Graph push subscriptions expire in a few days. Recreate/renew them on a
 * timer so a first-connect that happened before HTTPS was up, or a Graph
 * drop, still gets instant mailbox and OneDrive after the next tick.
 */
Artisan::command('graph:ensure-subscriptions', function () {
    EnsureGraphSubscriptions::dispatch();
    $this->info('Queued Graph subscription ensure.');
})->purpose('Create or renew Microsoft Graph change-notification subscriptions');

Schedule::command('graph:ensure-subscriptions')
    ->everyFiveMinutes()
    ->withoutOverlapping(15);

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

// Escalating email reminders (1h/20h/24h) for unread portal messages.
Schedule::command('messaging:send-unread-reminders')->everyFifteenMinutes()->withoutOverlapping(30);

/*
 * Create the firm-wide default conversation if it does not exist yet.
 *
 * Membership is not seeded here: OrganizationChat::syncMembership runs when a
 * staff member loads their conversations, so anyone approved later joins on
 * their next visit rather than needing this to be re-run. Outside accounts
 * are never added, and are dropped if they somehow already were.
 */
Artisan::command('messaging:org-chat', function () {
    $staff = User::where('account_type', 'Administrator')->orderBy('id')->first();
    $chat = OrganizationChat::ensure($staff);

    if ($staff) {
        OrganizationChat::syncMembership($staff);
    }

    $this->info("Organization chat ready: \"{$chat->name}\" ({$chat->uuid}).");
    $this->line('Staff join automatically the next time they open Messages. Outside accounts are kept out.');
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
// looking at, and is the fallback when Graph push is not available (local
// http, Google mail). Instant Microsoft delivery is hooks/microsoft-graph.
Schedule::command('mail:sync-all')
    ->everyMinute()
    // The job already drops overlapping runs per mailbox; this stops a slow
    // provider from stacking scheduler ticks on top of each other as well.
    ->withoutOverlapping(10);

/*
 * Wake snoozed messages that are due: clear the snooze (which returns the
 * message to its real folder — the listing hides rows with a snooze set) and
 * raise the reminder notification. This is what makes snooze a *reminder*
 * rather than just a hiding place; the toast/bell side is the ordinary
 * notification pipeline.
 */
Artisan::command('mail:wake-snoozed', function () {
    $due = MailMessage::query()
        ->whereNotNull('snoozed_until')
        ->where('snoozed_until', '<=', now())
        ->orderBy('snoozed_until')
        ->limit(200)
        ->get();

    foreach ($due as $message) {
        $message->forceFill(['snoozed_until' => null])->save();

        Notifier::send([
            'user' => $message->user_id,
            'type' => 'email.snooze_due',
            'title' => 'Reminder: '.($message->subject ?: 'a snoozed email'),
            'message' => trim('From '.($message->from_name ?: $message->from_email ?: 'unknown sender').' — back in your '.$message->folder),
            // Deep-link so the toast / panel click opens this exact message.
            'action_url' => '/email?message='.$message->uuid,
            'subject' => $message,
            'image' => MailSenderPhoto::urlFor((string) ($message->from_email ?? '')),
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
    ->withoutOverlapping(10);

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
                ->orWhereNotIn('subscription_status', ['disabled']);
        })
        ->where(function ($q) {
            $q->whereNull('subscription_synced_at')
                ->orWhereRaw('subscription_synced_at < ?', [now()->subMinutes(1)]);
        })
        ->get()
        // The frequency comparison is done here rather than in SQL because it
        // is per row, and the set is small. A live 'syncing' run holds its
        // slot; a stale one is reclaimed rather than skipped for ever.
        ->filter(fn (Calendar $c) => ! $c->syncRunIsLive()
            && ($c->subscription_synced_at === null
                || $c->subscription_synced_at->addMinutes((int) $c->subscription_frequency)->isPast()));

    foreach ($due as $calendar) {
        RefreshIcsSubscription::dispatch($calendar->id);
    }

    $this->info("Queued refresh for {$due->count()} subscription(s).");
})->purpose('Queue a refresh for every ICS subscription that is due');

Schedule::command('calendar:refresh-subscriptions')
    ->everyFifteenMinutes()
    ->withoutOverlapping(30);

/*
 * Pull every connected provider calendar up to date.
 *
 * Runs on the same principle as mail:sync-all — a calendar nobody has open
 * still needs to receive, so the timer covers it. The job drops overlapping
 * runs per calendar, and a calendar in a failed/backing-off state is skipped
 * until a manual sync clears it.
 */
Artisan::command('calendar:sync-providers', function () {
    /*
     * Due-ness is judged in PHP (the set is small): a live 'syncing' run
     * holds its slot, a stale one is reclaimed rather than skipped for ever,
     * and failures back off exponentially instead of the old permanent
     * cutoff at ten - both of which used to wedge a calendar out of the
     * schedule with no way back but a manual sync.
     */
    $calendars = Calendar::query()
        ->whereIn('source', [Calendar::SOURCE_GOOGLE, Calendar::SOURCE_MICROSOFT])
        ->whereNotNull('connected_account_id')
        ->get()
        ->filter(fn (Calendar $c) => $c->providerSyncIsDue());

    foreach ($calendars as $calendar) {
        SyncProviderCalendar::dispatch($calendar->id);
    }

    $this->info("Queued sync for {$calendars->count()} provider calendar(s).");
})->purpose('Queue an incremental sync for every connected provider calendar');

Schedule::command('calendar:sync-providers')
    ->everyTenMinutes()
    ->withoutOverlapping(30);

/*
 * Publish scheduled Feed posts whose time has come (§6).
 *
 * The tick only *finds* due posts; the job does the publishing and claims each
 * row conditionally, so a slow queue, a retry, or an author hitting "publish
 * now" mid-flight can never produce two publications of the same post.
 *
 * A window rather than an exact match: if the scheduler misses ticks (a
 * deploy, a paused worker) a post scheduled during the gap must still go out,
 * late, rather than be skipped forever. The status flip is what stops it
 * being picked up twice.
 */
Artisan::command('feed:publish-scheduled', function () {
    $due = FeedPost::query()
        ->where('status', FeedPost::STATUS_SCHEDULED)
        ->whereNotNull('scheduled_for')
        ->where('scheduled_for', '<=', now())
        ->orderBy('scheduled_for')
        ->limit(200)
        ->pluck('id');

    foreach ($due as $id) {
        PublishScheduledFeedPost::dispatch($id);
    }

    $this->info("Queued {$due->count()} scheduled post(s) for publication.");
})->purpose('Publish Feed posts whose scheduled time has arrived');

// Minute granularity matches the composer's time picker, which is to the minute.
Schedule::command('feed:publish-scheduled')
    ->everyMinute()
    ->withoutOverlapping(10);

/*
 * Remove staged Feed attachments that were never claimed by a post.
 *
 * The intake prunes the uploader's own stale rows on every upload so storage
 * stays bounded even with no scheduler running — a recurring problem on this
 * portal. This is the thorough pass across every uploader.
 */
Artisan::command('feed:prune-attachments {--hours=24}', function () {
    $hours = max(1, (int) $this->option('hours'));

    $stale = FeedAttachment::query()
        ->where('status', FeedAttachment::STATUS_STAGED)
        ->where('created_at', '<', now()->subHours($hours))
        ->get();

    foreach ($stale as $attachment) {
        try {
            Storage::disk($attachment->disk)->delete(array_filter([
                $attachment->path,
                $attachment->thumb_path,
            ]));
        } catch (Throwable) {
            // The row goes either way; bytes left behind are cheaper than a
            // prune that aborts halfway through on one unreachable file.
        }

        $attachment->forceDelete();
    }

    $this->info("Removed {$stale->count()} abandoned Feed attachment(s) older than {$hours}h.");
})->purpose('Remove staged Feed attachments that were never posted');

Schedule::command('feed:prune-attachments')->hourly();

/*
 * ── Smartsheet → CBI ─────────────────────────────────────────────────────
 *
 * One-way inbound sync for the CBI module (the firm is migrating OFF
 * Smartsheet; the portal never writes back). The tick walks the workspace
 * (one API call), then queues one job per sheet whose version moved — the
 * cheap /version gate is what keeps ~300 sheets inside Smartsheet's
 * 300 req/min budget. Everything is inert unless FEATURE_CBI is on and the
 * token is configured, so the schedule can ship dark.
 */
Artisan::command('smartsheet:sync
    {--queue : Dispatch per-sheet jobs instead of running inline}
    {--full : Re-fetch every sheet, ignoring version gates}', function () {
    if (! config('services.smartsheet.cbi_enabled')) {
        $this->info('CBI is disabled (FEATURE_CBI).');

        return;
    }
    if (ImportPause::smartsheet()) {
        $this->warn('Smartsheet imports are paused (Settings → Background Operations).');

        return;
    }
    if (! Client::configured()) {
        $this->warn('Smartsheet token or workspace id missing.');

        return;
    }

    $runId = (string) Str::uuid();
    $due = Synchroniser::refreshWorkspace($runId);

    if ($this->option('full')) {
        $due = SmartsheetSheet::query()
            ->where('sync_enabled', true)
            ->where('status', '!=', SmartsheetSheet::STATUS_GONE)
            ->get()
            ->all();
    }

    /*
     * --queue is for the deployed scheduler. Inline is the default because
     * the queue table is shared with the Cloud deployment: a worker there
     * pops any job whose class it doesn't have and discards it, so local
     * dispatches of a not-yet-deployed job class silently vanish.
     */
    if ($this->option('queue')) {
        foreach ($due as $sheet) {
            SyncSmartsheetSheet::dispatch($sheet, (bool) $this->option('full'));
        }
        $this->info('Queued '.count($due).' sheet sync(s).');

        return;
    }

    $done = 0;
    foreach ($due as $sheet) {
        attempt:
        $result = Synchroniser::syncSheet($sheet, $runId, (bool) $this->option('full'));
        if ($result['status'] === 'throttled') {
            $wait = max(1, (int) ($result['retryAfter'] ?? 30));
            $this->warn("Throttled; waiting {$wait}s…");
            sleep($wait);
            goto attempt;
        }
        // 'unchanged' maps too: a pass that mirrored but died mid-mapping
        // reports unchanged on retry, and mapping again is nearly free.
        if (in_array($result['status'], ['synced', 'unchanged'], true)) {
            Mapper::mapSheet($sheet->fresh());
        }
        $done++;
        $this->info("[{$done}/".count($due)."] {$result['status']}: {$sheet->name}");
    }

    $this->info('Synced '.count($due).' sheet(s).');
})->purpose('Discover Smartsheet changes and sync each changed sheet into CBI');

Schedule::command('smartsheet:sync --queue')
    ->everyTenMinutes()
    // The per-sheet job already refuses to overlap itself; this stops a slow
    // workspace walk from stacking scheduler ticks as well.
    ->withoutOverlapping(30);

/*
 * Client hub + paperwork, after the metadata sync.
 *
 * Sheet sync only mirrors names and sizes. This pass creates any missing
 * client records (with File Library folders) and copies attachment bytes into
 * those folders so CBI Documents and the client Documents tab open the same
 * file in the shared lightbox. Resumable: ImportCbiDocuments re-queues itself
 * while reachable files remain.
 */
Schedule::call(function () {
    if (! config('services.smartsheet.cbi_enabled')) {
        return;
    }
    if (ImportPause::smartsheet()) {
        return;
    }
    SyncCbiHub::dispatch();
})->name('cbi:sync-hub')->everyTenMinutes()->withoutOverlapping(30);

/*
 * Re-run the mirror → CBI mapping without touching the Smartsheet API.
 * This is the whole point of the two-layer design: mapping fixes are a
 * remap, never a re-walk. Safe to run any time; it upserts.
 */
Artisan::command('cbi:remap {--sheet= : Remote sheet id to remap alone}', function () {
    $query = SmartsheetSheet::query()
        ->whereIn('category', array_merge(
            SmartsheetSheet::APPLICATION_CATEGORIES,
            [SmartsheetSheet::CATEGORY_ASSESSMENT],
        ));

    if ($this->option('sheet')) {
        $query->where('remote_id', (int) $this->option('sheet'));
    }

    // Application sheets first so assessment matching has applications to
    // link against on a cold start.
    $sheets = $query->get()->sortBy(
        fn ($s) => $s->category === SmartsheetSheet::CATEGORY_ASSESSMENT ? 1 : 0
    );

    foreach ($sheets as $sheet) {
        // force: without it the per-row unchanged-skip makes a remap a
        // silent no-op — the whole point here is re-extracting everything.
        Mapper::mapSheet($sheet, force: true);
        $this->info("Mapped: {$sheet->name}");
    }

    $this->info('Remapped '.$sheets->count().' sheet(s).');
})->purpose('Re-run the Smartsheet mirror → CBI application mapping');

/*
 * The optional "Monthly security summary" email from Account settings →
 * Security. Off by default; only accounts that switched it on are mailed.
 *
 * Reads the month that just ended, so running it on the 1st describes a
 * complete month rather than a month-so-far. Nothing here can be triggered
 * by a user action — the summary is owed because a month passed — so like
 * every other periodic job it lives on the scheduler.
 */
Artisan::command('security:monthly-summary {--user= : Send to one user id, for a manual check}', function () {
    $start = now()->subMonthNoOverflow()->startOfMonth();
    $end = $start->copy()->endOfMonth();
    $period = $start->format('F Y');

    $users = User::query()
        ->where('status', User::STATUS_APPROVED)
        ->when($this->option('user'), fn ($q) => $q->where('id', (int) $this->option('user')))
        ->get()
        ->filter(fn (User $user) => $user->email
            && SecurityAlerts::enabled($user, 'monthly_summary'));

    $sent = 0;
    foreach ($users as $user) {
        $events = AuthEvent::where('user_id', $user->id)
            ->whereBetween('created_at', [$start, $end])
            ->get();

        $devices = $events->where('event', 'login')
            ->map(fn ($e) => (string) $e->user_agent)->unique()->count();

        $details = [
            ['Sign-ins', (string) $events->where('event', 'login')->count()],
            ['Devices used', (string) $devices],
            ['Failed sign-in attempts', (string) $events->whereIn('event', ['login_failed', 'lockout'])->count()],
            ['Password changes', (string) $events->where('event', 'password_reset')->count()],
            ['Two-factor authentication', $user->two_factor_confirmed_at ? 'On' : 'Off'],
        ];

        Deliveries::send(
            Postcards::securitySummary($period, $details, url('/security-settings'), $user->first_name ?: null),
            $user->email,
            $user,
            'securitySummary',
        );
        $sent++;
    }

    $this->info("Sent {$sent} security summary email(s) for {$period}.");
})->purpose('Email the opt-in monthly security summary');

Schedule::command('security:monthly-summary')->monthlyOn(1, '08:00');
