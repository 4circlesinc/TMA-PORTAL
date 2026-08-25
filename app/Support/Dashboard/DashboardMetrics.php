<?php

namespace App\Support\Dashboard;

use App\Models\CipDocumentComment;
use App\Models\CipEvent;
use App\Models\ConversationParticipant;
use App\Models\MailMessage;
use App\Models\Message;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Status as CipStatus;
use App\Support\Files\Workflow\Hub as WorkflowHub;
use App\Support\Signatures\Status;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The four KPI cards on the portal home, computed from real activity.
 *
 * Scope follows the reader: an administrator sees the whole firm, an employee
 * sees their own work. Service-provider contacts get a different four cards
 * for their CIP book and what is waiting on them. Other client accounts never
 * see these cards at all.
 *
 * Every card reports a trailing window against the window before it (or a live
 * backlog with the longest wait). Where there is nothing to measure the card
 * says so; it never falls back to a plausible-looking number.
 */
class DashboardMetrics
{
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

        $allStaffIds = [];
        $scopeStaffIds = [];
        $clients = ClientDirectory::none();

        if (Role::isStaff($this->user)) {
            $allStaffIds = User::query()
                ->whereIn('account_type', Role::STAFF)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

            $scopeStaffIds = $this->isAdministrator() ? $allStaffIds : [(int) $user->id];
            $clients = ClientDirectory::load();
        }

        $this->allStaffIds = $allStaffIds;
        $this->scopeStaffIds = $scopeStaffIds;
        $this->clients = $clients;
    }

    public function isStaff(): bool
    {
        return Role::isStaff($this->user);
    }

    public function isProviderContact(): bool
    {
        return CipAccess::isProviderContact($this->user);
    }

    private function isAdministrator(): bool
    {
        return Role::isAdmin($this->user);
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
                'cipNew' => $this->cipNewCard(),
                'cipUpdatesRequired' => $this->cipUpdatesRequiredCard(),
                'awaitingSignature' => $this->awaitingSignatureCard(),
            ],
        ];
    }

    /**
     * The four cards a service-provider contact opens their day on: the CIP
     * filings still in flight, the ones sent back for updates, unread portal
     * messages, and unresolved comments on their documents.
     *
     * @return array<string, mixed>
     */
    public function providerToArray(): array
    {
        return [
            'scope' => 'provider',
            'windowDays' => $this->windowDays,
            'cards' => [
                'cipActive' => $this->cipActiveCard(),
                'cipUpdatesRequired' => $this->cipUpdatesRequiredCard(),
                'unreadMessages' => $this->unreadMessagesCard(),
                'openComments' => $this->openCommentsCard(),
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
                'value' => '-',
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
            // The arrow reports direction, not goodness, a falling response
            // time is an improvement, and shows a down arrow.
            'deltaUp' => $priorAverage !== null && $average > $priorAverage,
            'sample' => count($current),
            'hint' => Format::plural(count($current), 'client reply', 'client replies')
                .' in the last '.$this->windowDays.' days, across portal messages and email.',
        ];
    }

    /* ── card 2: new CIP applications ──────────────────────────────── */

    /** @return array<string, mixed> */
    private function cipNewCard(): array
    {
        if (! CipAccess::enabled()) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => '-',
                'deltaUp' => false,
                'hint' => 'CIP is not enabled on this portal.',
            ];
        }

        $filed = fn (CarbonImmutable $from, CarbonImmutable $to) => ApplicationScope::query($this->user)
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->count();

        $current = $filed($this->windowStart, $this->now);
        $prior = $filed($this->priorStart, $this->windowStart);

        return [
            'value' => Format::count($current),
            'count' => $current,
            'delta' => Format::change($current, $prior === 0 ? null : $prior),
            'deltaUp' => $current >= $prior,
            'hint' => 'New CIP applications filed in the last '.$this->windowDays.' days.',
        ];
    }

    /* ── card 3: CIP applications waiting on updates ───────────────── */

    /** @return array<string, mixed> */
    private function cipUpdatesRequiredCard(): array
    {
        if (! CipAccess::enabled()) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => '-',
                'deltaUp' => false,
                'hint' => 'CIP is not enabled on this portal.',
            ];
        }

        $apps = ApplicationScope::query($this->user)
            ->where('status', CipStatus::UPDATE_REQUIRED)
            ->get(['id', 'updated_at']);

        $count = $apps->count();

        if ($count === 0) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => 'All clear',
                'deltaUp' => true,
                'hint' => 'No CIP applications are waiting on updates.',
            ];
        }

        $entered = CipEvent::query()
            ->whereIn('application_id', $apps->pluck('id')->all())
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', CipStatus::UPDATE_REQUIRED)
            ->selectRaw('application_id, max(created_at) as entered_at')
            ->groupBy('application_id')
            ->pluck('entered_at', 'application_id');

        $longest = 0;
        foreach ($apps as $app) {
            $at = isset($entered[$app->id])
                ? CarbonImmutable::parse((string) $entered[$app->id])
                : CarbonImmutable::instance($app->updated_at);
            $longest = max($longest, (int) $at->diffInSeconds($this->now));
        }

        return [
            'value' => Format::count($count),
            'count' => $count,
            'longestSeconds' => $longest,
            'delta' => Format::duration($longest).' waiting',
            // More files waiting is worse, so the arrow always points down
            // while anyone is unanswered.
            'deltaUp' => false,
            'hint' => Format::plural($count, 'application is', 'applications are')
                .' waiting on updates from the provider.',
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
            // longer outstanding, it needs re-sending, which is a different
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
        // longest, the one worth chasing.
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

    /* ── provider card: live CIP filings ───────────────────────────── */

    /** @return array<string, mixed> */
    private function cipActiveCard(): array
    {
        if (! CipAccess::enabled()) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => '-',
                'deltaUp' => false,
                'hint' => 'CIP is not enabled on this portal.',
            ];
        }

        $count = ApplicationScope::query($this->user)
            ->whereNotIn('status', CipStatus::TERMINAL)
            ->count();

        $filed = fn (CarbonImmutable $from, CarbonImmutable $to) => ApplicationScope::query($this->user)
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->count();

        $current = $filed($this->windowStart, $this->now);
        $prior = $filed($this->priorStart, $this->windowStart);

        if ($count === 0) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => 'None in progress',
                'deltaUp' => true,
                'hint' => 'No CIP applications are in progress.',
            ];
        }

        return [
            'value' => Format::count($count),
            'count' => $count,
            'delta' => Format::change($current, $prior === 0 ? null : $prior),
            'deltaUp' => $current >= $prior,
            'hint' => Format::plural($count, 'application is', 'applications are')
                .' still in progress.',
        ];
    }

    /* ── provider card: unread portal messages ─────────────────────── */

    /** @return array<string, mixed> */
    private function unreadMessagesCard(): array
    {
        $count = (int) DB::table('messages')
            ->join('conversation_participants as cp', function ($join) {
                $join->on('cp.conversation_id', '=', 'messages.conversation_id')
                    ->where('cp.user_id', '=', $this->user->id)
                    ->whereNull('cp.left_at');
            })
            ->whereNull('messages.deleted_at')
            ->where('messages.type', '!=', Message::TYPE_SYSTEM)
            ->whereRaw('messages.id > coalesce(cp.last_read_message_id, 0)')
            ->whereRaw('messages.id > coalesce(cp.cleared_before_message_id, 0)')
            ->where(function ($q) {
                $q->whereNull('messages.user_id')
                    ->orWhere('messages.user_id', '!=', $this->user->id);
            })
            ->count();

        if ($count === 0) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => 'All caught up',
                'deltaUp' => true,
                'hint' => 'No unread portal messages.',
            ];
        }

        return [
            'value' => Format::count($count),
            'count' => $count,
            'delta' => 'Waiting for you',
            'deltaUp' => false,
            'hint' => Format::plural($count, 'message is', 'messages are').' waiting to be read.',
        ];
    }

    /* ── provider card: open CIP + file comments ───────────────────── */

    /** @return array<string, mixed> */
    private function openCommentsCard(): array
    {
        $cipOpen = 0;

        if (CipAccess::enabled()) {
            $cipOpen = CipDocumentComment::query()
                ->whereNull('parent_id')
                ->whereNull('resolved_at')
                ->whereHas(
                    'document',
                    fn ($q) => $q->whereIn('application_id', ApplicationScope::query($this->user)->select('id'))
                )
                ->count();
        }

        $mentions = WorkflowHub::counts($this->user)['mentions'];
        $count = $cipOpen + $mentions;

        if ($count === 0) {
            return [
                'value' => '0',
                'count' => 0,
                'delta' => 'All clear',
                'deltaUp' => true,
                'hint' => 'No open comments on your documents.',
            ];
        }

        return [
            'value' => Format::count($count),
            'count' => $count,
            'delta' => 'Needs a look',
            'deltaUp' => false,
            'hint' => Format::plural($count, 'comment thread is', 'comment threads are')
                .' still open on your documents.',
        ];
    }

    /* ── channel readers ───────────────────────────────────────────── */

    /**
     * Client and staff activity from both channels, merged into one set of
     * threads. Built once for the response-time card.
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
     * staff member in the same thread are considered, internal chatter is not
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
