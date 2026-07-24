<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Server-side record of one mailbox's synchronization run.
 *
 * One row per connected account, reused across runs. Everything the progress
 * panel shows comes from here, so the display survives refreshes, closed tabs
 * and worker restarts — and a stalled run is detectable by comparing
 * last_progress_at against the clock rather than trusting a spinner.
 */
class MailSyncProgress extends Model
{
    protected $table = 'mail_sync_progress';

    protected $guarded = [];

    /**
     * The stages a full run walks through, in order. Keys are what's stored;
     * values are what the user reads. Attachments are counted but not
     * pre-downloaded — bytes stream from the provider on demand — so there is
     * deliberately no "downloading attachments" stage that could never finish.
     */
    public const STAGES = [
        'connecting' => 'Connecting account',
        'verifying' => 'Verifying permissions',
        'folders' => 'Reading mailbox folders',
        'counting' => 'Counting messages',
        'attachments' => 'Counting attachments',
        'preparing' => 'Preparing import',
        'importing' => 'Importing messages',
        'threads' => 'Building conversations',
        'finalizing' => 'Finalizing synchronization',
        'done' => 'Mailbox up to date',
    ];

    protected function casts(): array
    {
        return [
            'totals_estimated' => 'boolean',
            'started_at' => 'datetime',
            'last_progress_at' => 'datetime',
            'completed_at' => 'datetime',
            'last_retry_at' => 'datetime',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }

    /** The row for an account, created on first use. */
    public static function for(ConnectedAccount $account): self
    {
        return self::firstOrCreate(
            ['connected_account_id' => $account->id],
            [
                'user_id' => $account->user_id,
                'provider' => $account->provider,
            ]
        );
    }

    /**
     * Reset for a fresh run (a new connect, or a manual retry after failure).
     * Totals are kept — stale numbers beat no numbers while the re-count
     * runs — but stage, status and the clocks start over.
     */
    public function begin(): self
    {
        $this->forceFill([
            'status' => 'running',
            'current_stage' => 'connecting',
            'current_folder' => null,
            'percentage' => null,
            'started_at' => now(),
            'last_progress_at' => now(),
            'completed_at' => null,
            'error_code' => null,
            'error_message' => null,
        ])->save();

        return $this;
    }

    /** Move to a named stage; every stage change counts as progress. */
    public function enterStage(string $stage, array $extra = []): self
    {
        $this->forceFill(array_merge([
            'status' => 'running',
            'current_stage' => $stage,
            'last_progress_at' => now(),
        ], $extra))->save();

        return $this;
    }

    /** A heartbeat with optional counter updates — proof the run is alive. */
    public function beat(array $extra = []): self
    {
        $this->forceFill(array_merge(['last_progress_at' => now()], $extra))->save();

        return $this;
    }

    public function finish(array $extra = []): self
    {
        $this->forceFill(array_merge([
            'status' => 'completed',
            'current_stage' => 'done',
            'current_folder' => null,
            'percentage' => 100,
            'completed_at' => now(),
            'last_progress_at' => now(),
            'error_code' => null,
            'error_message' => null,
        ], $extra))->save();

        return $this;
    }

    public function fail(string $code, string $message): self
    {
        $this->forceFill([
            'status' => 'failed',
            'error_code' => $code,
            'error_message' => $message,
            'last_progress_at' => now(),
        ])->save();

        return $this;
    }

    /** 1-based position of the current stage, for "step 4 of 10". */
    public function stageNumber(): int
    {
        $index = array_search($this->current_stage, array_keys(self::STAGES), true);

        return $index === false ? 1 : $index + 1;
    }

    public function stageLabel(): string
    {
        return self::STAGES[$this->current_stage] ?? 'Working';
    }

    public function isRunning(): bool
    {
        return $this->status === 'running';
    }

    /**
     * No sign of life for this long means something is wrong — the worker is
     * down, the job died, or the provider stopped answering. Kept at the low
     * end of the 30–60s window so the user hears about a problem before they
     * give up on the screen.
     */
    public const STALL_AFTER_SECONDS = 45;

    public function isStalled(): bool
    {
        return $this->isRunning()
            && $this->last_progress_at !== null
            && $this->last_progress_at->lt(now()->subSeconds(self::STALL_AFTER_SECONDS));
    }

    /**
     * What the mirror actually holds for this account right now — the honest
     * numerators the panel shows. Conversations and attachment breakdowns come
     * from imported data (they grow as the import runs); nothing here is
     * invented to make a percentage move.
     *
     * @return array<string, int>
     */
    public static function statsFor(ConnectedAccount $account): array
    {
        $base = MailMessage::query()->where('connected_account_id', $account->id);

        $attachments = MailAttachment::query()
            ->join('mail_messages', 'mail_messages.id', '=', 'mail_attachments.mail_message_id')
            ->where('mail_messages.connected_account_id', $account->id)
            ->where('mail_attachments.is_inline', false)
            ->selectRaw("count(*) as total, sum(case when mail_attachments.mime_type like 'image/%' then 1 else 0 end) as images")
            ->first();

        $total = (int) ($attachments->total ?? 0);
        $images = (int) ($attachments->images ?? 0);

        return [
            'processed_messages' => (clone $base)->count(),
            'total_conversations' => (clone $base)->whereNotNull('thread_id')->distinct()->count('thread_id'),
            // "Attachments found so far": messages the import has seen that
            // carry files. Metadata rows (and the image/document split) only
            // exist once a message has been opened or hydrated.
            'processed_attachments' => (clone $base)->where('has_attachments', true)->count(),
            'total_images' => $images,
            'total_documents' => max(0, $total - $images),
        ];
    }
}
