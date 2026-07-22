<?php

namespace App\Support\Dashboard;

use App\Models\ConversationParticipant;
use App\Models\MailMessage;
use App\Models\Message;
use App\Models\Share;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Signatures\Status;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The four KPI cards on the portal home, computed from real activity.
 *
 * Scope follows the reader: an administrator sees the whole firm, an employee
 * sees their own work. Clients never see these cards at all — they measure how
 * well the firm serves clients, so they are staff-facing by definition.
 *
 * Every card reports a trailing window against the window before it. Where
 * there is nothing to measure the card says so; it never falls back to a
 * plausible-looking number.
 */
class DashboardMetrics
{
    private const STAFF_TYPES = ['Administrator', 'Employee'];

    private readonly CarbonImmutable $now;

    private readonly CarbonImmutable $windowStart;

    private readonly CarbonImmutable $priorStart;

    private readonly CarbonImmutable $lookbackStart;

    private readonly int $windowDays;

    /** Staff whose activity is in scope (the reader, or the whole firm). */
    private readonly array $scopeStaffIds;

    /** Everyone who can answer a client, regardless of scope. */
    private readonly array $allStaffIds;

    private readonly ClientDirectory $clients;

    public function __construct(private readonly User $user)
    {
        $this->windowDays = max(1, (int) config('portal.metrics.window_days', 30));
        $lookbackDays = max($this->windowDays * 2, (int) config('portal.metrics.lookback_days', 90));

        $this->now = CarbonImmutable::now();
        $this->windowStart = $this->now->subDays($this->windowDays);
        $this->priorStart = $this->now->subDays($this->windowDays * 2);
        $this->lookbackStart = $this->now->subDays($lookbackDays);

        $this->allStaffIds = User::query()
            ->whereIn('account_type', self::STAFF_TYPES)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->scopeStaffIds = $this->isAdministrator() ? $this->allStaffIds : [(int) $user->id];

        $this->clients = ClientDirectory::load();
    }

    public function isStaff(): bool
    {
        return in_array($this->user->account_type, self::STAFF_TYPES, true);
    }

    private function isAdministrator(): bool
    {
        return $this->user->account_type === 'Administrator';
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        $timelines = $this->buildTimelines();

        return [
            'scope' => $this->isAdministrator() ? 'organization' : 'personal',
            'windowDays' => $this->windowDays,
            'cards' => [
                'clientResponse' => $this->clientResponseCard($timelines),
                'filesShared' => $this->filesSharedCard(),
                'awaitingReply' => $this->awaitingReplyCard($timelines),
                'awaitingSignature' => $this->awaitingSignatureCard(),
            ],
        ];
    }

    /* ── card 1: average staff response to clients ─────────────────── */

    /** @return array<string, mixed> */
    private function clientResponseCard(Timelines $timelines): array
    {
        $current = [];
        $prior = [];

        foreach ($timelines->responsePairs() as $pair) {
            if ($pair['askedAt'] >= $this->windowStart) {
                $current[] = $pair['seconds'];
            } elseif ($pair['askedAt'] >= $this->priorStart) {
                $prior[] = $pair['seconds'];
            }
        }

        if ($current === []) {
            return [
                'value' => '—',
                'delta' => 'No replies yet',
                'deltaUp' => false,
                'sample' => 0,
                'hint' => 'Average time to answer a client, across portal messages and email.',
            ];
        }

        $average = (int) round(array_sum($current) / count($current));
        $priorAverage = $prior === [] ? null : (int) round(array_sum($prior) / count($prior));

        return [
            'value' => Format::duration($average),
            'seconds' => $average,
            'delta' => Format::change($average, $priorAverage),
            // The arrow reports direction, not goodness — a falling response
            // time is an improvement, and shows a down arrow.
            'deltaUp' => $priorAverage !== null && $average > $priorAverage,
            'sample' => count($current),
            'hint' => Format::plural(count($current), 'client reply', 'client replies')
                .' in the last '.$this->windowDays.' days, across portal messages and email.',
        ];
    }

    /* ── card 2: files shared ──────────────────────────────────────── */

    /** @return array<string, mixed> */
    private function filesSharedCard(): array
    {
        $shared = fn (CarbonImmutable $from, CarbonImmutable $to) => Share::query()
            ->whereIn('shared_by', $this->scopeStaffIds)
            ->whereNull('revoked_at')
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->count();

        $current = $shared($this->windowStart, $this->now);
        $prior = $shared($this->priorStart, $this->windowStart);

        return [
            'value' => Format::count($current),
            'count' => $current,
            'delta' => Format::change($current, $prior === 0 ? null : $prior),
            'deltaUp' => $current >= $prior,
            'hint' => 'Files and folders shared in the last '.$this->windowDays.' days. Revoked shares are not counted.',
        ];
    }

    /* ── card 3: clients awaiting a reply ──────────────────────────── */

    /** @return array<string, mixed> */
    private function awaitingReplyCard(Timelines $timelines): array
    {
        $waits = $timelines->awaiting($this->now);
        $count = count($waits);

        if ($count === 0) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => 'All answered',
                'deltaUp' => true,
                'hint' => 'No client is waiting on a reply.',
            ];
        }

        $longest = max($waits);

        return [
            'value' => Format::count($count),
            'count' => $count,
            'longestSeconds' => $longest,
            'delta' => Format::duration($longest).' waiting',
            // More people waiting is worse, so this card's arrow always points
            // down while anyone is unanswered.
            'deltaUp' => false,
            'hint' => Format::plural($count, 'client has', 'clients have').' sent a message with no reply yet.',
        ];
    }

    /* ── card 4: documents awaiting signature ──────────────────────── */

    /**
     * Documents that are out with recipients and not signed yet.
     *
     * Counted per document, not per recipient: a request three people still
     * have to sign is one thing waiting on the admin's desk, not three.
     *
     * @return array<string, mixed>
     */
    private function awaitingSignatureCard(): array
    {
        $outstanding = SignatureRequest::query()
            ->whereIn('created_by', $this->scopeStaffIds)
            ->whereIn('status', Status::PENDING)
            // A request past its expiry can't be signed any more, so it is no
            // longer outstanding — it needs re-sending, which is a different
            // problem from waiting on a signer.
            ->where(function ($query) {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', $this->now);
            })
            ->orderBy('sent_at')
            ->get(['sent_at']);

        $count = $outstanding->count();

        if ($count === 0) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => 'All signed',
                'deltaUp' => true,
                'hint' => 'No documents are waiting to be signed.',
            ];
        }

        // Oldest first, so the head of the list is the one that has been out
        // longest — the one worth chasing.
        $oldestSentAt = $outstanding->first()->sent_at;
        $waiting = $oldestSentAt ? (int) $oldestSentAt->diffInSeconds($this->now) : null;

        return [
            'value' => Format::count($count),
            'count' => $count,
            'longestSeconds' => $waiting,
            'delta' => $waiting === null ? 'Awaiting' : Format::duration($waiting).' waiting',
            'deltaUp' => false,
            'hint' => Format::plural($count, 'document is', 'documents are').' out for signature and unsigned.',
        ];
    }

    /* ── channel readers ───────────────────────────────────────────── */

    /**
     * Client and staff activity from both channels, merged into one set of
     * threads. Built once and shared by the two cards that read it.
     */
    private function buildTimelines(): Timelines
    {
        $timelines = new Timelines;

        if ($this->clients->isEmpty() || $this->scopeStaffIds === []) {
            return $timelines;
        }

        $this->addPortalMessages($timelines);
        $this->addMailThreads($timelines);

        return $timelines;
    }

    /**
     * Portal messaging. Only conversations that put a client and an in-scope
     * staff member in the same thread are considered — internal chatter is not
     * a client response time.
     */
    private function addPortalMessages(Timelines $timelines): void
    {
        $clientUserIds = $this->clients->userIds();

        if ($clientUserIds === []) {
            return;
        }

        $conversationIds = ConversationParticipant::query()
            ->whereIn('user_id', $clientUserIds)
            ->whereIn(
                'conversation_id',
                ConversationParticipant::query()
                    ->whereIn('user_id', $this->scopeStaffIds)
                    ->select('conversation_id')
            )
            ->distinct()
            ->pluck('conversation_id')
            ->all();

        if ($conversationIds === []) {
            return;
        }

        $messages = Message::query()
            ->whereIn('conversation_id', $conversationIds)
            ->where('created_at', '>=', $this->lookbackStart)
            ->whereNotNull('user_id')
            ->where('type', '!=', 'system')
            ->orderBy('conversation_id')
            ->orderBy('id')
            ->get(['conversation_id', 'user_id', 'created_at']);

        $staff = array_flip($this->allStaffIds);

        foreach ($messages as $message) {
            $thread = 'conversation:'.$message->conversation_id;
            $userId = (int) $message->user_id;
            $at = CarbonImmutable::instance($message->created_at);

            if ($key = $this->clients->keyForUser($userId)) {
                $timelines->addClient($thread, $at, $key);
            } elseif (isset($staff[$userId])) {
                $timelines->addStaff($thread, $at);
            }
        }
    }

    /**
     * Connected mailboxes. A client's mail lands in a staff inbox and the reply
     * leaves from the same mailbox, so a thread is keyed by mailbox *and*
     * provider thread id: two people answering the same client in their own
     * mailboxes are two separate conversations.
     *
     * Mail with no thread id can't be paired with its reply and is skipped
     * rather than guessed at.
     */
    private function addMailThreads(Timelines $timelines): void
    {
        $emails = $this->clients->emails();

        if ($emails === []) {
            return;
        }

        $inbound = MailMessage::query()
            ->whereIn('user_id', $this->scopeStaffIds)
            ->where('folder', 'inbox')
            ->whereNotNull('thread_id')
            ->whereNotNull('sent_at')
            ->where('sent_at', '>=', $this->lookbackStart)
            ->whereIn(DB::raw('lower(from_email)'), $emails)
            ->orderBy('sent_at')
            ->get(['user_id', 'thread_id', 'from_email', 'sent_at']);

        if ($inbound->isEmpty()) {
            return;
        }

        foreach ($inbound as $mail) {
            $key = $this->clients->keyForEmail($mail->from_email);

            if ($key === null) {
                continue;
            }

            $timelines->addClient(
                $this->mailThreadKey((int) $mail->user_id, $mail->thread_id),
                CarbonImmutable::instance($mail->sent_at),
                $key
            );
        }

        // Only the threads a client actually wrote into need their replies.
        $outbound = MailMessage::query()
            ->whereIn('user_id', $this->scopeStaffIds)
            ->where('folder', 'sent')
            ->whereIn('thread_id', $inbound->pluck('thread_id')->unique()->all())
            ->whereNotNull('sent_at')
            ->where('sent_at', '>=', $this->lookbackStart)
            ->orderBy('sent_at')
            ->get(['user_id', 'thread_id', 'sent_at']);

        foreach ($outbound as $mail) {
            $timelines->addStaff(
                $this->mailThreadKey((int) $mail->user_id, $mail->thread_id),
                CarbonImmutable::instance($mail->sent_at)
            );
        }
    }

    private function mailThreadKey(int $userId, string $threadId): string
    {
        return 'mail:'.$userId.':'.$threadId;
    }
}
