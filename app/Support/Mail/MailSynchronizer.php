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

    /**
     * "Has anything arrived?" — one small request, safe to run every few seconds.
     *
     * A mailbox has to feel live, and a full incremental pass cannot: it walks
     * six folders and pages through each, so running it on a five-second timer
     * means each poll is still working when the next one starts, and the
     * provider begins throttling. That is what "auto sync isn't working" looks
     * like from the outside — not a sync that never runs, but one that never
     * finishes.
     *
     * This asks only the inbox, only for what is newer than the newest message
     * already stored, and never advances the cursor. The full pass stays the
     * authority on reads, moves and deletions; this only gets arrivals on
     * screen quickly. Overlap between the two is harmless — the upsert is
     * idempotent.
     *
     * @return int the number of messages written
     */
    public function quickCheck(int $limit = 25): int
    {
        $newest = MailMessage::query()
            ->where('connected_account_id', $this->account->id)
            ->where('folder', 'inbox')
            ->max('sent_at');

        // Nothing stored yet means the seed has not run; there is no useful
        // watermark, and a full pass is what is actually needed.
        if (! $newest) {
            return 0;
        }

        // A second of overlap, because `ge` against the newest stored message
        // would otherwise turn into "strictly after" the moment two messages
        // share a timestamp. Re-reading one costs nothing.
        $since = Carbon::parse($newest)->subSecond()->toIso8601ZuluString();

        $messages = Mailbox::provider($this->account)->newMessages('inbox', $since, $limit);

        if ($messages === []) {
            return 0;
        }

        $written = $this->bulkUpsert($messages);

        // Only the timestamp moves — not the cursor. The full pass still has
        // to cover this window for everything a listing cannot report.
        $this->account->forceFill(['mail_synced_at' => now()])->save();

        return $written;
    }

    /** First pass: list every folder, then start a change feed from here. */
    private function seed(): int
    {
        $provider = Mailbox::provider($this->account);
        $written = 0;

        $this->syncLabels();

        foreach (Mailbox::FOLDERS as $folder) {
            $page = $provider->listMessages($folder, self::SEED_PER_FOLDER);

            // Listing rows, so the same page-at-a-time write the backfill uses.
            $written += $this->bulkUpsert($page['messages']);
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

        // Ask the provider once how big the mailbox is, so progress can be
        // shown as a real fraction instead of a spinner with no end in sight.
        if (! isset($progress['_totals'])) {
            $progress['_totals'] = rescue(fn () => $provider->folderTotals(), [], report: false);
            $this->account->forceFill(['mail_backfill' => $progress])->save();
        }

        foreach (Mailbox::FOLDERS as $folder) {
            $state = $progress[$folder] ?? ['token' => null, 'done' => false];

            // A folder with no token that has already run is finished.
            while (! ($state['done'] ?? false) && $pages < $maxPages) {
                $page = $provider->listMessages($folder, $perPage, $state['token'] ?? null);

                // One statement per page, not per message. The database is
                // remote, so a per-message upsert costs ~1s in round trips —
                // roughly ten hours for a 30,000-message mailbox.
                $written += $this->bulkUpsert($page['messages']);

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
     * Write a whole page of list rows in one statement.
     *
     * Used by the backfill, where volume matters more than the extras: these
     * rows come from a listing, so they carry no body and no attachments, and
     * categories are left to the regular sync. Existing rows are refreshed
     * without disturbing their uuid or the body already cached against them.
     *
     * @param  array<int, array<string, mixed>>  $messages
     */
    /**
     * Fit a provider value into its column. Real mail carries display names,
     * subjects and thread ids far longer than the schema allows, and one
     * oversized row would otherwise abort the whole page's insert.
     */
    private static function clamp(mixed $value, int $limit): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $value = (string) $value;

        return mb_strlen($value) > $limit ? mb_substr($value, 0, $limit) : $value;
    }

    private function bulkUpsert(array $messages): int
    {
        $now = now();
        $rows = [];

        foreach ($messages as $m) {
            if (empty($m['remote_id'])) {
                continue;
            }

            $rows[] = [
                'uuid' => (string) Str::uuid(),
                'user_id' => $this->account->user_id,
                'connected_account_id' => $this->account->id,
                'remote_id' => self::clamp($m['remote_id'], 255),
                'thread_id' => self::clamp($m['thread_id'] ?? null, 255),
                'folder' => self::clamp($m['folder'] ?? 'inbox', 20),
                'subject' => self::clamp($m['subject'] ?? null, 998),
                'snippet' => $m['snippet'] ?? null,
                'from_name' => self::clamp($m['from_name'] ?? null, 255),
                'from_email' => self::clamp($m['from_email'] ?? null, 255),
                // Written through the query builder, so JSON columns are
                // encoded here rather than by a model cast.
                'to' => json_encode($m['to'] ?? []),
                'cc' => json_encode($m['cc'] ?? []),
                'bcc' => json_encode($m['bcc'] ?? []),
                'reply_to' => self::clamp($m['reply_to'] ?? null, 255),
                'is_read' => (bool) ($m['is_read'] ?? false),
                'is_starred' => (bool) ($m['is_starred'] ?? false),
                'is_important' => (bool) ($m['is_important'] ?? false),
                'has_attachments' => (bool) ($m['has_attachments'] ?? false),
                'sent_at' => empty($m['sent_at']) ? null : Carbon::createFromTimestamp($m['sent_at']),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($rows === []) {
            return 0;
        }

        MailMessage::upsert(
            $rows,
            ['connected_account_id', 'remote_id'],
            [
                'thread_id', 'folder', 'subject', 'snippet', 'from_name', 'from_email',
                'to', 'cc', 'bcc', 'reply_to', 'is_read', 'is_starred', 'is_important',
                'has_attachments', 'sent_at', 'updated_at',
            ]
        );

        return count($rows);
    }

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

            $this->writeMessage($row, $message);
        });
    }

    /** Copy a normalized provider message onto a row and persist it. */
    private function writeMessage(MailMessage $row, array $message): void
    {
        if (! $row->exists) {
            $row->connected_account_id = $this->account->id;
            $row->remote_id = $message['remote_id'];
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
