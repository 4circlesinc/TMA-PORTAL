<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\MailSyncProgress;
use App\Support\Mail\Mailbox;
use App\Support\Mail\MailSyncError;
use App\Support\Mail\MailTokens;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * The quick mailbox analysis that runs the moment an account connects.
 *
 * Deliberately separate from the import: this verifies the grant, reads the
 * folder list and asks the provider for its own totals — a handful of small
 * requests, seconds of work — so the user sees "8,420 messages found" within
 * moments of connecting instead of a spinner that answers nothing for the
 * whole import. The heavy lifting (SyncMailbox seed, BackfillMailbox history
 * walk) is dispatched from here and runs on the queue behind it.
 */
class AnalyzeMailbox implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 90;

    public int $uniqueFor = 120;

    public function __construct(
        public ConnectedAccount $account,
    ) {}

    public function uniqueId(): string
    {
        return (string) $this->account->id;
    }

    /**
     * Reset the progress record and queue a full analysis. What a fresh
     * connect (or a manual retry) calls, so the panel starts from
     * "Connecting account" rather than whatever the last run left behind.
     */
    public static function start(ConnectedAccount $account): void
    {
        MailSyncProgress::for($account)->begin();

        self::dispatch($account);
    }

    public function handle(): void
    {
        $account = $this->account->fresh();

        if (! $account || ! $account->sync_email || ! $account->token) {
            return;
        }

        $progress = MailSyncProgress::for($account);

        // Already importing and showing signs of life — re-analyzing would
        // just bounce the panel back to "Connecting". Make sure the import
        // job is actually queued (the whole failure mode this redesign fixes)
        // and step aside.
        if ($progress->isRunning() && $progress->current_stage === 'importing' && ! $progress->isStalled()) {
            if (! $account->mail_backfilled_at) {
                BackfillMailbox::dispatch($account);
            }

            return;
        }

        if (! $progress->isRunning()) {
            $progress->begin();
        }

        try {
            $this->analyze($account, $progress);
        } catch (\Throwable $e) {
            $failure = MailSyncError::describe($e);
            $progress->fail($failure['code'], $failure['message']);

            logger()->error('mail: mailbox analysis failed', [
                'account' => $account->id,
                'provider' => $account->provider,
                'code' => $failure['code'],
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }

    private function analyze(ConnectedAccount $account, MailSyncProgress $progress): void
    {
        // Stage: verifying. Minting an access token is the whole check — a
        // revoked grant or missing scope throws MailAuthException here, which
        // becomes an "auth" failure the panel can explain.
        $progress->enterStage('verifying');
        MailTokens::accessToken($account);

        $provider = Mailbox::provider($account);

        // Stage: folders + counting. The provider's own per-folder totals —
        // one request on Graph — give the real denominator within seconds.
        $progress->enterStage('folders');
        $totals = rescue(fn () => $provider->folderTotals(), [], report: false);

        // Also stored where the backfill's legacy math reads it.
        if ($totals !== []) {
            $backfill = $account->mail_backfill ?? [];
            $backfill['_totals'] = $totals;
            $account->forceFill(['mail_backfill' => $backfill])->save();
        }

        $progress->enterStage('counting', [
            'total_messages' => $totals === [] ? null : array_sum($totals),
        ]);

        // Stage: attachments. A cheap provider-side count where offered;
        // otherwise the import counts what it actually finds.
        $progress->enterStage('attachments');
        $attachmentCounts = rescue(fn () => $provider->attachmentCounts(), [], report: false);

        $progress->enterStage('preparing', array_merge(
            ['total_attachments' => $attachmentCounts === [] ? null : array_sum($attachmentCounts)],
            MailSyncProgress::statsFor($account),
        ));

        // The seed / incremental pass paints the first messages quickly.
        SyncMailbox::dispatch($account);

        // Reconnecting a mailbox whose history is already imported must not
        // start it over: the messages are preserved, duplicates are prevented
        // by the provider message id upsert, and only new mail flows in via
        // the incremental sync just dispatched.
        if ($account->mail_backfilled_at !== null) {
            $progress->finish(array_merge(
                ['totals_estimated' => false],
                MailSyncProgress::statsFor($account),
            ));

            return;
        }

        $progress->enterStage('importing');
        BackfillMailbox::dispatch($account);
    }

    public function failed(\Throwable $e): void
    {
        $failure = MailSyncError::describe($e);

        MailSyncProgress::for($this->account)->fail($failure['code'], $failure['message']);

        if ($failure['code'] === 'auth') {
            $this->account->forceFill([
                'mail_status' => 'error',
                'mail_error' => $e->getMessage(),
            ])->save();
        }
    }
}
