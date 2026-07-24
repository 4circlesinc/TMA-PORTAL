<?php

namespace App\Support\Mail;

use App\Jobs\ResolveSenderPhoto;
use App\Models\ConnectedAccount;
use App\Models\MailLabel;
use App\Models\MailMessage;
use App\Models\MailSenderPhoto;
use App\Models\MailSyncProgress;
use App\Support\Notifications\Notifier;
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

        // Which of these are genuinely new, before the upsert makes them all
        // look old. The overlap window re-reads known messages on purpose, so
        // "returned by the provider" is not the same as "new".
        $incoming = array_values(array_filter(array_map(
            fn (array $m): ?string => $m['remote_id'] ?? null,
            $messages,
        )));
        $known = MailMessage::query()
            ->where('connected_account_id', $this->account->id)
            ->whereIn('remote_id', $incoming)
            ->pluck('remote_id')
            ->all();

        $written = $this->bulkUpsert($messages);

        rescue(fn () => $this->notifyNewMail(array_values(array_diff($incoming, $known))), report: false);

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
        $tracker = MailSyncProgress::for($this->account);
        $written = 0;
        $pages = 0;

        // Ask the provider once how big the mailbox is, so progress can be
        // shown as a real fraction instead of a spinner with no end in sight.
        if (! isset($progress['_totals'])) {
            $progress['_totals'] = rescue(fn () => $provider->folderTotals(), [], report: false);
            $this->account->forceFill(['mail_backfill' => $progress])->save();
        }

        // The denominator for the percentage. Usually set by AnalyzeMailbox;
        // adopted from the provider totals when the backfill was started some
        // other way (e.g. the artisan command).
        $totalMessages = $tracker->total_messages
            ?: (($progress['_totals'] ?? []) === [] ? null : array_sum(array_map('intval', $progress['_totals'])));

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

                // Heartbeat after every batch: real counts, the folder being
                // walked, and the resume token. This is what the progress
                // panel reads, and what stall detection measures against.
                $stats = MailSyncProgress::statsFor($this->account);
                $tracker->beat(array_merge($stats, [
                    'status' => 'running',
                    'current_stage' => 'importing',
                    'current_folder' => $folder,
                    'total_messages' => $totalMessages,
                    'percentage' => $totalMessages
                        ? min(99, (int) floor($stats['processed_messages'] / max(1, $totalMessages) * 100))
                        : null,
                    'next_link' => $state['token'],
                ]));
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
        $created = [];

        foreach ($changes['messages'] as $message) {
            if ($this->upsert($message) && ! empty($message['remote_id'])) {
                $created[] = (string) $message['remote_id'];
            }
            $written++;
        }

        rescue(fn () => $this->notifyNewMail($created), report: false);

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

    /** @return bool whether the message was new to the mirror */
    private function upsert(array $message): bool
    {
        if (empty($message['remote_id'])) {
            return false;
        }

        return DB::transaction(function () use ($message): bool {
            $row = MailMessage::firstOrNew([
                'connected_account_id' => $this->account->id,
                'remote_id' => $message['remote_id'],
            ]);

            $isNew = ! $row->exists;

            $this->writeMessage($row, $message);

            return $isNew;
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

        // Portal-only labels exist nowhere in the provider's feed, so a plain
        // sync() would silently strip them from the message on every pass.
        $local = $row->labels()
            ->where('remote_id', 'like', MailLabel::LOCAL_PREFIX.'%')
            ->pluck('mail_labels.id')
            ->all();

        $row->labels()->sync(array_values(array_unique(array_merge($ids, $local))));
    }

    /**
     * Raise portal notifications for mail that just arrived.
     *
     * Only ever called with messages the mirror had never seen (the seed and
     * the backfill import history and deliberately never come through here),
     * and filtered down further to what a person would call "new mail": in
     * the inbox, unread, recent, and not something they sent themselves.
     *
     * A burst collapses into one summary row rather than one notification per
     * message — reconnecting after a weekend must not ring the bell 40 times.
     * The per-message dedupe key keeps the quick check and the full pass from
     * double-announcing the same arrival.
     *
     * @param  array<int, string>  $remoteIds
     */
    private function notifyNewMail(array $remoteIds): void
    {
        if ($remoteIds === []) {
            return;
        }

        $own = mb_strtolower((string) $this->account->email);

        $rows = MailMessage::query()
            ->where('connected_account_id', $this->account->id)
            ->whereIn('remote_id', $remoteIds)
            ->where('folder', 'inbox')
            ->where('is_read', false)
            ->where('sent_at', '>=', now()->subDay())
            ->orderByDesc('sent_at')
            ->get()
            ->reject(fn (MailMessage $m): bool => mb_strtolower((string) $m->from_email) === $own)
            ->values();

        if ($rows->isEmpty()) {
            return;
        }

        if ($rows->count() > 3) {
            $senders = $rows
                ->map(fn (MailMessage $m): string => (string) ($m->from_name ?: $m->from_email))
                ->filter()
                ->unique()
                ->take(3);

            $first = $rows->first();
            $this->queueSenderPhoto((string) ($first->from_email ?? ''));

            Notifier::send([
                'user' => $this->account->user_id,
                'type' => 'email.received',
                'title' => $rows->count().' new emails',
                'message' => $senders->isNotEmpty() ? 'From '.$senders->implode(', ').'…' : null,
                'action_url' => '/email?message='.$first->uuid,
                'subject' => $first,
                'image' => MailSenderPhoto::faceUrlFor((string) ($first->from_email ?? '')),
                'metadata' => [
                    'from_email' => mb_strtolower((string) ($first->from_email ?? '')),
                    'from_name' => (string) ($first->from_name ?: $first->from_email ?: 'Sender'),
                    'message_uuid' => $first->uuid,
                ],
                'dedupe_key' => 'email.received.batch:'.$this->account->id,
                'dedupe_minutes' => 15,
            ]);

            return;
        }

        foreach ($rows as $m) {
            $fromEmail = mb_strtolower((string) ($m->from_email ?? ''));
            $this->queueSenderPhoto($fromEmail);

            Notifier::send([
                'user' => $this->account->user_id,
                'type' => 'email.received',
                'title' => 'New email from '.($m->from_name ?: $m->from_email ?: 'an unknown sender'),
                'message' => $m->subject ?: Str::limit((string) $m->snippet, 120),
                'action_url' => '/email?message='.$m->uuid,
                'subject' => $m,
                'image' => MailSenderPhoto::faceUrlFor($fromEmail),
                'metadata' => [
                    'from_email' => $fromEmail,
                    'from_name' => (string) ($m->from_name ?: $m->from_email ?: 'Sender'),
                    'message_uuid' => $m->uuid,
                ],
                'dedupe_key' => 'email.received:'.$m->remote_id,
            ]);
        }
    }

    /** Ask the photo queue about this sender so the next toast can show a face. */
    private function queueSenderPhoto(string $email): void
    {
        $email = mb_strtolower(trim($email));
        if ($email === '' || ! str_contains($email, '@')) {
            return;
        }
        if (MailSenderPhoto::needsFaceResolve($email)) {
            ResolveSenderPhoto::dispatch($this->account, $email);
        }
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
