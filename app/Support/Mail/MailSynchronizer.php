<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use App\Models\MailLabel;
use App\Models\MailMessage;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Mirrors a connected mailbox into the local tables.
 *
 * Two modes: a seed pass that lists each folder, and an incremental pass that
 * replays the provider's change feed. The incremental pass is what runs
 * normally; the seed only runs on first connect or when a cursor has aged out.
 */
class MailSynchronizer
{
    /** How many messages the first pass pulls per folder. */
    private const SEED_PER_FOLDER = 100;

    /** Page size for the history backfill; providers cap this around 100. */
    private const BACKFILL_PER_PAGE = 100;

    public function __construct(
        private readonly ConnectedAccount $account,
    ) {}

    /** @return int the number of messages written */
    public function sync(): int
    {
        $this->account->forceFill(['mail_status' => 'syncing', 'mail_error' => null])->save();

        try {
            $written = $this->account->mail_cursor
                ? $this->incremental()
                : $this->seed();

            $this->account->forceFill([
                'mail_status' => 'idle',
                'mail_synced_at' => now(),
                'mail_error' => null,
            ])->save();

            return $written;
        } catch (MailCursorExpiredException) {
            // Recoverable: drop the stale cursor and rebuild from a listing.
            $this->account->forceFill(['mail_cursor' => null])->save();

            $written = $this->seed();

            $this->account->forceFill([
                'mail_status' => 'idle',
                'mail_synced_at' => now(),
                'mail_error' => null,
            ])->save();

            return $written;
        } catch (Throwable $e) {
            $this->account->forceFill([
                'mail_status' => 'error',
                'mail_error' => $e->getMessage(),
            ])->save();

            throw $e;
        }
    }

    /** First pass: list every folder, then start a change feed from here. */
    private function seed(): int
    {
        $provider = Mailbox::provider($this->account);
        $written = 0;

        $this->syncLabels();

        foreach (Mailbox::FOLDERS as $folder) {
            $page = $provider->listMessages($folder, self::SEED_PER_FOLDER);

            foreach ($page['messages'] as $message) {
                $this->upsert($message);
                $written++;
            }
        }

        // Open the change feed only after the listing, so nothing that
        // arrives mid-seed is missed.
        $this->account->forceFill([
            'mail_cursor' => $provider->changesSince(null)['cursor'],
        ])->save();

        return $written;
    }

    /**
     * Pull older history, a slice at a time. The seed only takes the newest
     * SEED_PER_FOLDER per folder so the page is usable immediately; this walks
     * back through the rest using the provider's page token.
     *
     * Returns ['written' => int, 'done' => bool]. Call again while done is
     * false — progress is saved after every page, so it resumes safely.
     *
     * @return array{written:int, done:bool}
     */
    public function backfillStep(int $maxPages = 5, int $perPage = self::BACKFILL_PER_PAGE): array
    {
        $provider = Mailbox::provider($this->account);
        $progress = $this->account->mail_backfill ?? [];
        $written = 0;
        $pages = 0;

        foreach (Mailbox::FOLDERS as $folder) {
            $state = $progress[$folder] ?? ['token' => null, 'done' => false];

            // A folder with no token that has already run is finished.
            while (! ($state['done'] ?? false) && $pages < $maxPages) {
                $page = $provider->listMessages($folder, $perPage, $state['token'] ?? null);

                foreach ($page['messages'] as $message) {
                    $this->upsert($message);
                    $written++;
                }

                $pages++;
                $state = ['token' => $page['cursor'], 'done' => $page['cursor'] === null];

                // Persist after each page so a crash resumes here, not at zero.
                $progress[$folder] = $state;
                $this->account->forceFill(['mail_backfill' => $progress])->save();
            }

            if ($pages >= $maxPages) {
                break;
            }
        }

        $done = collect(Mailbox::FOLDERS)
            ->every(fn (string $f) => ($progress[$f]['done'] ?? false) === true);

        if ($done) {
            $this->account->forceFill(['mail_backfilled_at' => now()])->save();
        }

        return ['written' => $written, 'done' => $done];
    }

    /** Steady state: replay only what changed. */
    private function incremental(): int
    {
        $provider = Mailbox::provider($this->account);
        $changes = $provider->changesSince($this->account->mail_cursor);

        $written = 0;

        foreach ($changes['messages'] as $message) {
            $this->upsert($message);
            $written++;
        }

        if ($changes['deleted'] !== []) {
            MailMessage::query()
                ->where('connected_account_id', $this->account->id)
                ->whereIn('remote_id', $changes['deleted'])
                ->delete();
        }

        $this->account->forceFill(['mail_cursor' => $changes['cursor']])->save();

        return $written;
    }

    /** Pulls the user's labels/categories so the chips render real names. */
    public function syncLabels(): void
    {
        $labels = Mailbox::provider($this->account)->listLabels();

        // Rotate through the tones the email UI already ships, so labels get
        // stable, distinguishable colours without the user picking any.
        $tones = ['blue', 'green', 'purple', 'orange', 'red', 'gray'];
        $index = 0;

        foreach ($labels as $label) {
            if ($label['system']) {
                continue;
            }

            MailLabel::updateOrCreate(
                [
                    'connected_account_id' => $this->account->id,
                    'remote_id' => $label['id'],
                ],
                [
                    'uuid' => (string) Str::uuid(),
                    'user_id' => $this->account->user_id,
                    'name' => $label['name'],
                    'tone' => $tones[$index++ % count($tones)],
                    'is_system' => false,
                ]
            );
        }
    }

    /**
     * Writes one provider message, preserving anything the provider did not
     * send. A metadata-only listing has no body, and must not blank the body
     * a previous full fetch already cached.
     *
     * @param  array<string, mixed>  $message
     */
    private function upsert(array $message): void
    {
        if (empty($message['remote_id'])) {
            return;
        }

        DB::transaction(function () use ($message) {
            $row = MailMessage::firstOrNew([
                'connected_account_id' => $this->account->id,
                'remote_id' => $message['remote_id'],
            ]);

            if (! $row->exists) {
                $row->uuid = (string) Str::uuid();
                $row->user_id = $this->account->user_id;
            }

            foreach ([
                'thread_id', 'folder', 'subject', 'snippet', 'from_name', 'from_email',
                'to', 'cc', 'bcc', 'reply_to', 'is_read', 'is_starred', 'is_important',
                'has_attachments', 'body_html', 'body_text',
            ] as $field) {
                if (array_key_exists($field, $message)) {
                    $row->{$field} = $message[$field];
                }
            }

            if (! empty($message['sent_at'])) {
                $row->sent_at = Carbon::createFromTimestamp($message['sent_at']);
            }

            $row->save();

            if (array_key_exists('label_ids', $message)) {
                $this->syncMessageLabels($row, $message['label_ids']);
            }

            if (! empty($message['attachments'])) {
                $this->syncAttachments($row, $message['attachments']);
            }
        });
    }

    /** @param array<int, string> $remoteLabelIds */
    private function syncMessageLabels(MailMessage $row, array $remoteLabelIds): void
    {
        $ids = MailLabel::query()
            ->where('connected_account_id', $this->account->id)
            ->whereIn('remote_id', $remoteLabelIds)
            ->pluck('id')
            ->all();

        $row->labels()->sync($ids);
    }

    /** @param array<int, array<string, mixed>> $attachments */
    private function syncAttachments(MailMessage $row, array $attachments): void
    {
        // Attachments never change on a sent message, so a full replace is
        // both correct and simpler than diffing.
        $row->attachments()->delete();

        foreach ($attachments as $attachment) {
            $row->attachments()->create([
                'uuid' => (string) Str::uuid(),
                'remote_id' => $attachment['remote_id'] ?? null,
                'filename' => $attachment['filename'] ?? 'attachment',
                'mime_type' => $attachment['mime_type'] ?? null,
                'size' => $attachment['size'] ?? 0,
                'is_inline' => $attachment['is_inline'] ?? false,
                'content_id' => $attachment['content_id'] ?? null,
            ]);
        }
    }
}
