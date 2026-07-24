<?php

namespace App\Http\Controllers;

use App\Jobs\ResolveSenderPhoto;
use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\MailAttachment;
use App\Models\MailDraft;
use App\Models\MailLabel;
use App\Models\MailMessage;
use App\Models\MailSenderPhoto;
use App\Models\User;
use App\Support\Mail\MailAuthException;
use App\Support\Mail\Mailbox;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

/**
 * The email page's API.
 *
 * Every write goes to the provider first and is only mirrored locally once it
 * succeeds — the mailbox is the source of truth, and a local row that claims
 * something the provider rejected would be a lie the user acts on. Reads come
 * from the mirror, so the list paints without waiting on a round trip.
 *
 * Messages are addressed by uuid; provider ids stay server-side.
 */
class MailController extends Controller
{
    private const PER_PAGE = 50;

    /** Page sizes the inbox's "per page" control offers. */
    public const PER_PAGE_OPTIONS = [25, 50, 100, 200];

    /** Bootstrap: connection state, folder counts, labels. */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $account = Mailbox::accountFor($user);

        if (! $account) {
            return response()->json([
                'connected' => false,
                'folders' => [],
                'labels' => [],
            ]);
        }

        // Freshen in the background; the page renders from the mirror either
        // way. Guarded because on a synchronous queue this runs inline, and a
        // provider outage must not stop the mailbox from opening — the stored
        // sync status is how a failure gets reported.
        rescue(function () use ($account) {
            // Called as a statement, not returned: dispatch() hands back a
            // PendingDispatch that only fires when it is destroyed, and
            // returning it would push that past this guard.
            SyncMailbox::dispatch($account);
        }, report: false);

        return response()->json([
            'connected' => true,
            'account' => [
                'provider' => $account->provider,
                'email' => $account->email,
                'name' => $account->name,
                'canWrite' => $account->canWriteMail(),
                'status' => $account->mail_status,
                'error' => $account->mail_error,
                'syncedAt' => $account->mail_synced_at?->toIso8601String(),
            ],
            'folders' => $this->folderCounts($user->id),
            'labels' => MailLabel::where('user_id', $user->id)
                ->where('is_system', false)
                ->orderBy('name')
                ->get()
                ->map->toRecord()
                ->values(),
        ]);
    }

    /** A folder listing, or a provider-side search when `q` is present. */
    public function messages(Request $request): JsonResponse
    {
        $data = $request->validate([
            'folder' => ['sometimes', 'string', 'in:'.implode(',', Mailbox::FOLDERS)],
            'q' => ['sometimes', 'nullable', 'string', 'max:200'],
            'label' => ['sometimes', 'nullable', 'string', 'uuid'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'in:'.implode(',', self::PER_PAGE_OPTIONS)],
        ]);

        $user = $request->user();
        $search = trim((string) ($data['q'] ?? ''));

        if ($search !== '') {
            return response()->json(['messages' => $this->search($request, $search)]);
        }

        $query = MailMessage::query()
            ->with(['labels', 'attachments'])
            ->where('user_id', $user->id)
            ->where('folder', $data['folder'] ?? 'inbox');

        if ($labelUuid = $data['label'] ?? null) {
            $query->whereHas('labels', fn ($q) => $q->where('uuid', $labelUuid));
        }

        $perPage = (int) ($data['perPage'] ?? self::PER_PAGE);

        $page = $query
            ->orderByDesc('sent_at')
            ->paginate($perPage, ['*'], 'page', $data['page'] ?? 1);

        return response()->json([
            'messages' => $this->withAvatars(collect($page->items())),
            'total' => $page->total(),
            'hasMore' => $page->hasMorePages(),
            'page' => $page->currentPage(),
            'perPage' => $page->perPage(),
            'lastPage' => $page->lastPage(),
            'perPageOptions' => self::PER_PAGE_OPTIONS,
        ]);
    }

    /**
     * Progress of the history backfill, for the corner panel on the email page.
     *
     * `total` is what the provider says the mailbox holds; it is absent for a
     * folder the provider does not report, so the UI shows a count rather than
     * a false percentage.
     */
    public function syncStatus(Request $request): JsonResponse
    {
        $user = $request->user();
        $account = Mailbox::accountFor($user);

        if (! $account) {
            return response()->json(['connected' => false, 'running' => false]);
        }

        $synced = MailMessage::where('user_id', $user->id)
            ->selectRaw('folder, count(*) as c')
            ->groupBy('folder')
            ->pluck('c', 'folder')
            ->map(fn ($c) => (int) $c)
            ->all();

        $progress = $account->mail_backfill ?? [];
        $totals = array_map('intval', $progress['_totals'] ?? []);

        $folders = [];
        foreach (Mailbox::FOLDERS as $folder) {
            $folders[] = [
                'folder' => $folder,
                'synced' => $synced[$folder] ?? 0,
                'total' => $totals[$folder] ?? null,
                'done' => (bool) ($progress[$folder]['done'] ?? false),
            ];
        }

        $done = $account->mail_backfilled_at !== null;

        return response()->json([
            'connected' => true,
            // Running while there is history still to pull. The panel hides
            // itself once this goes false.
            'running' => ! $done,
            'done' => $done,
            'status' => $account->mail_status,
            'error' => $account->mail_error,
            'synced' => array_sum($synced),
            'total' => $totals === [] ? null : array_sum($totals),
            'folders' => $folders,
            'syncedAt' => $account->mail_synced_at?->toIso8601String(),
        ]);
    }

    /**
     * A sender's cached profile photo.
     *
     * Read-only: this never calls the provider. A page can reference dozens of
     * distinct senders at once, and the first version of this endpoint fetched
     * from Microsoft Graph inline here — a burst of <img> loads meant a burst
     * of blocking ~1s Graph calls, which was enough to take the whole mailbox
     * page down. Fetching now happens only in the background
     * ({@see ResolveSenderPhoto}); this just serves whatever has
     * already been cached and queues that job if nobody has asked yet.
     *
     * Addressed by hash so no email address ends up in page markup. A sender
     * with no photo (yet, or ever) gets a 404, which the UI treats as "draw
     * initials" — never blocking on it.
     */
    public function senderPhoto(Request $request, string $hash): mixed
    {
        $account = Mailbox::accountFor($request->user());
        abort_unless($account, 404);

        $row = MailSenderPhoto::where('hash', $hash)->first();

        // Only serve addresses this mailbox has actually corresponded with, so
        // the endpoint can't be used to probe the directory for arbitrary people.
        // Distinct addresses only — there are a few hundred of those against
        // tens of thousands of messages.
        $email = $row?->email ?? MailMessage::where('user_id', $request->user()->id)
            ->whereNotNull('from_email')
            ->distinct()
            ->pluck('from_email')
            ->first(fn ($address) => MailSenderPhoto::hashFor((string) $address) === $hash);

        abort_unless($email, 404);

        $photo = MailSenderPhoto::cachedOnly($email);

        if (! $photo) {
            if (MailSenderPhoto::needsBackgroundResolve($email)) {
                ResolveSenderPhoto::dispatch($account, $email);
            }
            abort(404);
        }

        return response($photo['body'], 200, [
            'Content-Type' => $photo['mime'],
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /**
     * Attach a sender picture to each row. Senders who have a portal account
     * with a real photo get it; everyone else falls back to initials in the UI,
     * so nobody is given an invented avatar.
     *
     * @param  Collection<int, MailMessage>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function withAvatars(Collection $messages): array
    {
        $emails = $messages
            ->pluck('from_email')
            ->filter()
            ->map(fn ($e) => mb_strtolower((string) $e))
            ->unique()
            ->values()
            ->all();

        $avatars = $emails === [] ? [] : User::query()
            ->whereIn(DB::raw('lower(email)'), $emails)
            ->whereNotNull('avatar_url')
            ->get(['email', 'avatar_url'])
            ->mapWithKeys(fn (User $u) => [mb_strtolower($u->email) => $u->avatar_url])
            ->all();

        // Sender photos come from two places: the provider directory (a real
        // photo for a colleague) and the sender domain's brand logo (PayPal, a
        // bank, a newsletter). Nothing here calls either — a URL is only handed
        // out for a sender whose photo is already cached. Anyone not yet
        // resolved gets a background job queued (once per address, not per row)
        // and initials now, so the page never waits on a live lookup.
        $account = Mailbox::accountFor(request()->user());
        $own = $account ? mb_strtolower((string) $account->email) : null;

        // Skip the mailbox's own address and any sender who already resolves to
        // a portal photo; everyone else is a candidate for a directory or brand
        // logo.
        $resolvable = $account
            ? collect($emails)->reject(fn ($e) => $e === $own || isset($avatars[$e]))->values()
            : collect();

        $cached = $resolvable->isEmpty() ? [] : MailSenderPhoto::query()
            ->whereIn('hash', $resolvable->map(fn ($e) => MailSenderPhoto::hashFor($e)))
            ->get()
            ->keyBy('email')
            ->all();

        foreach ($resolvable as $email) {
            $row = $cached[$email] ?? null;
            $fresh = $row && $row->isFresh();

            if ($fresh && $row->has_photo) {
                continue; // Already have the photo; nothing to queue.
            }
            if (! $fresh) {
                ResolveSenderPhoto::dispatch($account, $email);
            }
        }

        return $messages->map(function (MailMessage $m) use ($avatars, $cached) {
            $row = $m->toRow();
            $row['avatarUrl'] = self::avatarFor($m, $avatars, $cached);

            return $row;
        })->values()->all();
    }

    /**
     * The same sender-picture resolution as {@see withAvatars}, but over the
     * full record each thread card needs rather than the list row.
     *
     * @param  Collection<int, MailMessage>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function withThreadAvatars(Collection $messages): array
    {
        // Reuse the list path for the lookups and the background queuing, then
        // key what it found by message so the record shape can borrow it.
        $rows = collect($this->withAvatars($messages))->keyBy('id');

        return $messages->map(function (MailMessage $m) use ($rows) {
            $record = $m->toRecord();
            $record['avatarUrl'] = $rows[$m->uuid]['avatarUrl'] ?? null;

            return $record;
        })->values()->all();
    }

    /**
     * A portal account's own photo first, then whatever the directory or brand
     * lookup has already cached. Never a live call, and never an invented
     * picture — the UI draws initials when this returns null.
     *
     * @param  array<string, string>  $avatars
     * @param  array<string, MailSenderPhoto>  $cached
     */
    private static function avatarFor(MailMessage $m, array $avatars, array $cached): ?string
    {
        $email = mb_strtolower((string) $m->from_email);

        if ($url = $avatars[$email] ?? null) {
            return $url;
        }

        $photo = $cached[$email] ?? null;

        return $photo && $photo->isFresh() && $photo->has_photo
            ? route('mail.sender-photo', ['hash' => $photo->hash])
            : null;
    }

    /**
     * One message, with its body. Bodies are fetched from the provider on
     * first open and cached, so the second open is local.
     */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $message = $this->findMessage($request, $uuid);

        $this->hydrate($message);

        $message->load('labels');

        return response()->json(['message' => $message->toRecord()]);
    }

    /**
     * Every message in one conversation, oldest first.
     *
     * The reading pane used to show only the message that was clicked, with
     * the rest of the conversation nowhere — replies, forwards and quoted
     * history simply were not rendered. This returns the whole thread so each
     * message can be its own card.
     *
     * Only the message being opened is hydrated from the provider here. A long
     * thread would otherwise cost one round trip per message before anything
     * painted; the others carry whatever body is already cached and report
     * `bodyLoaded: false` so the client can pull them from {@see show} when
     * the reader expands them.
     */
    public function thread(Request $request, string $uuid): JsonResponse
    {
        $message = $this->findMessage($request, $uuid);

        $this->hydrate($message);

        // A message with no thread id (some providers leave it empty on
        // single-message conversations) is a thread of one rather than an
        // error — grouping on an empty string would pull in every other
        // message that also lacks one.
        $messages = $message->thread_id
            ? MailMessage::query()
                ->with(['attachments', 'labels'])
                ->where('user_id', $request->user()->id)
                ->where('thread_id', $message->thread_id)
                // Drafts belong to the compose window, not the transcript.
                ->where('folder', '!=', 'draft')
                ->orderBy('sent_at')
                ->orderBy('id')
                ->get()
            : collect([$message->load(['attachments', 'labels'])]);

        // The opened message carries freshly hydrated body/attachments on this
        // instance; the query above re-read it from the database, so swap the
        // hydrated copy back in rather than serving the stale row. Its labels
        // are loaded to match what the query gave every other message —
        // without it the opened card would be the one showing no label chips.
        $message->load('labels');

        $messages = $messages->map(
            fn (MailMessage $m) => $m->id === $message->id ? $message : $m
        );

        return response()->json([
            'threadId' => $message->thread_id,
            // The conversation is titled by what it is about, which is the
            // subject the *first* message set — not the "Re: Re: Fwd:" the
            // newest reply happens to be carrying.
            'subject' => $messages->first()?->subject ?? $message->subject,
            'messages' => $this->withThreadAvatars($messages),
        ]);
    }

    /**
     * Fetch and cache a message's body, recipients and attachment list.
     *
     * Safe to call on an already-hydrated message: it only reaches the provider
     * when something is genuinely missing.
     */
    private function hydrate(MailMessage $message): void
    {
        $noBody = $message->body_html === null && $message->body_text === null;
        // A message flagged as having attachments but with zero attachment
        // rows was opened before attachments were fetched at all - the body
        // came back cached with nothing to show underneath it. This affects
        // every message read before that support existed, not just the
        // `cid:` case below, so it is checked unconditionally.
        $missingAttachments = $message->has_attachments && $message->attachments()->doesntExist();
        $justFetched = false;

        if ($noBody || $missingAttachments) {
            $full = $this->fetchFromProvider($message);

            if ($full) {
                $message->forceFill([
                    'body_html' => $full['body_html'] ?? $message->body_html,
                    'body_text' => $full['body_text'] ?? $message->body_text,
                    'cc' => $full['cc'] ?? $message->cc,
                    'reply_to' => $full['reply_to'] ?? $message->reply_to,
                    'has_attachments' => ! empty($full['attachments']),
                ])->save();

                if (! empty($full['attachments'])) {
                    // The body is already saved above, so a malformed
                    // attachment list costs the attachments and nothing more —
                    // the message itself still reads.
                    try {
                        $this->saveAttachments($message, $full['attachments']);
                    } catch (\Throwable $e) {
                        logger()->error('mail: attachment metadata failed to save', [
                            'message_uuid' => $message->uuid,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }

                // load() refreshes the relation on this same instance, rather
                // than fresh()'s whole new (and disconnected) copy — three
                // separate remote round trips used to go into what should be
                // one open: this reload, then another to re-read what
                // embedInlineImages had to persist on that disconnected copy
                // to get it back, then a third at the very end for labels.
                $message->load('attachments');
                $this->embedInlineImages($message);
                $justFetched = true;
            }
        }

        if (! $message->relationLoaded('attachments')) {
            $message->load('attachments');
        }

        // A body cached before embedded pictures were supported still carries
        // raw `cid:` references, which render as broken images. Repair it on
        // this open rather than leaving it broken for good. Only reachable
        // for a message that did NOT just go through the fetch above - that
        // path already called embedInlineImages with current data.
        if (! $justFetched && $message->body_html && str_contains($message->body_html, 'cid:')) {
            if ($message->attachments->whereNotNull('content_id')->isEmpty()) {
                $this->refreshAttachments($message);
                $message->load('attachments');
            }

            $this->embedInlineImages($message);
        }
    }

    /**
     * One provider read for a message, with the failure recorded rather than
     * swallowed. A null return means the caller serves whatever is cached.
     *
     * @return array<string, mixed>|null
     */
    private function fetchFromProvider(MailMessage $message): ?array
    {
        try {
            return Mailbox::provider($message->account)->getMessage($message->remote_id);
        } catch (\Throwable $e) {
            // Deliberately not rethrown: a message whose body will not load is
            // still worth opening for its headers and whatever is cached. But
            // it must not vanish silently the way `report: false` left it —
            // "the body is blank" was unreportable before this.
            logger()->error('mail: message body fetch failed', [
                'message_uuid' => $message->uuid,
                'provider' => $message->account?->provider,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Write a message's attachment rows in one statement, not one per file.
     *
     * The database is remote (Cloud Postgres), so each individual `->create()`
     * costs a real network round trip - a message with Outlook's habit of
     * stamping 5-10 tiny signature images as attachments turned "open an email
     * for the first time" into several extra seconds of nothing but sequential
     * inserts, on top of the provider call itself.
     *
     * @param  array<int, array<string, mixed>>  $attachments
     */
    private function saveAttachments(MailMessage $message, array $attachments): void
    {
        $message->attachments()->delete();

        $now = now();
        $rows = array_map(fn (array $a) => [
            'uuid' => (string) Str::uuid(),
            'mail_message_id' => $message->id,
            'remote_id' => $a['remote_id'] ?? null,
            'filename' => $a['filename'] ?? 'attachment',
            'mime_type' => $a['mime_type'] ?? null,
            'size' => $a['size'] ?? 0,
            'is_inline' => $a['is_inline'] ?? false,
            'content_id' => $a['content_id'] ?? null,
            'created_at' => $now,
            'updated_at' => $now,
        ], $attachments);

        MailAttachment::insert($rows);
    }

    /** Re-read the message's attachment list from the provider. */
    private function refreshAttachments(MailMessage $message): void
    {
        $full = rescue(
            fn () => Mailbox::provider($message->account)->getMessage($message->remote_id),
            null,
            report: false
        );

        if (empty($full['attachments'])) {
            return;
        }

        $this->saveAttachments($message, $full['attachments']);
    }

    /**
     * Point the body's `cid:` references at the attachment endpoint.
     *
     * Embedded pictures arrive as separate attachments the HTML refers to by
     * content id. They are rewritten to URLs rather than embedded as data URIs:
     * inlining the bytes grew one real message from 0.16 MB to 1.63 MB, which
     * is then stored and re-sent on every open. The body frame runs same-origin
     * (scripts still blocked), so these load over the authenticated session.
     */
    private function embedInlineImages(MailMessage $message): void
    {
        $html = $message->body_html;
        if (! $html || ! str_contains($html, 'cid:')) {
            return;
        }

        $inline = $message->attachments->filter(
            fn (MailAttachment $a) => $a->content_id && $a->remote_id
        );

        if ($inline->isEmpty()) {
            // The body points at embedded pictures the attachment list does not
            // describe, so those `cid:` references stay unresolved and render
            // as broken images. Worth knowing about; not worth failing the open.
            logger()->warning('mail: body references cid: with no matching attachment', [
                'message_uuid' => $message->uuid,
            ]);

            return;
        }

        $replaced = false;

        foreach ($inline as $attachment) {
            $cid = trim((string) $attachment->content_id, '<>');
            if ($cid === '') {
                continue;
            }

            $url = route('mail.attachment', ['uuid' => $attachment->uuid]).'?inline=1';

            foreach (['cid:'.$cid, 'cid:'.rawurlencode($cid)] as $needle) {
                if (str_contains($html, $needle)) {
                    $html = str_replace($needle, $url, $html);
                    $replaced = true;
                }
            }
        }

        if ($replaced) {
            $message->forceFill(['body_html' => $html])->save();
        }
    }

    /** Read / starred / important flags. */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'read' => ['sometimes', 'boolean'],
            'starred' => ['sometimes', 'boolean'],
            'important' => ['sometimes', 'boolean'],
        ]);

        $message = $this->findMessage($request, $uuid);
        $provider = Mailbox::provider($message->account);

        if (array_key_exists('read', $data)) {
            $provider->markRead($message->remote_id, $data['read']);
            $message->is_read = $data['read'];
        }

        if (array_key_exists('starred', $data)) {
            $provider->star($message->remote_id, $data['starred']);
            $message->is_starred = $data['starred'];
        }

        // Only mirrored where the provider has the concept; on Outlook the
        // local flag would drift from a mailbox that cannot store it.
        if (array_key_exists('important', $data) && $provider->supportsImportant()) {
            $provider->markImportant($message->remote_id, $data['important']);
            $message->is_important = $data['important'];
        }

        $message->save();

        return response()->json(['message' => $message->fresh('labels')->toRow()]);
    }

    /** Archive / trash / spam / restore to inbox. */
    public function move(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'folder' => ['required', 'string', 'in:inbox,archive,spam,trash'],
        ]);

        $message = $this->findMessage($request, $uuid);

        Mailbox::provider($message->account)->move($message->remote_id, $data['folder']);
        $message->forceFill(['folder' => $data['folder']])->save();

        return response()->json([
            'message' => $message->toRow(),
            'folders' => $this->folderCounts($request->user()->id),
        ]);
    }

    /** Permanent delete, bypassing Trash. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $message = $this->findMessage($request, $uuid);

        Mailbox::provider($message->account)->delete($message->remote_id);
        $message->delete();

        return response()->json(['folders' => $this->folderCounts($request->user()->id)]);
    }

    /**
     * The toolbar's multi-select actions. Applied one at a time because
     * neither provider offers a batch endpoint covering all of them; failures
     * are collected rather than aborting the rest.
     */
    public function bulk(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'max:100'],
            'ids.*' => ['string', 'uuid'],
            'action' => ['required', 'string', 'in:read,unread,star,unstar,archive,trash,spam,inbox,delete'],
        ]);

        $messages = MailMessage::query()
            ->where('user_id', $request->user()->id)
            ->whereIn('uuid', $data['ids'])
            ->get();

        $failed = 0;

        foreach ($messages as $message) {
            try {
                $this->applyBulk($message, $data['action']);
            } catch (\Throwable) {
                $failed++;
            }
        }

        return response()->json([
            'applied' => $messages->count() - $failed,
            'failed' => $failed,
            'folders' => $this->folderCounts($request->user()->id),
        ]);
    }

    private function applyBulk(MailMessage $message, string $action): void
    {
        $provider = Mailbox::provider($message->account);

        // The provider call comes first in every branch: if it throws, the
        // local row keeps its old state and the caller counts a failure.
        switch ($action) {
            case 'read':
            case 'unread':
                $provider->markRead($message->remote_id, $action === 'read');
                $message->forceFill(['is_read' => $action === 'read'])->save();
                break;

            case 'star':
            case 'unstar':
                $provider->star($message->remote_id, $action === 'star');
                $message->forceFill(['is_starred' => $action === 'star'])->save();
                break;

            case 'delete':
                $provider->delete($message->remote_id);
                $message->delete();
                break;

            default:
                $provider->move($message->remote_id, $action);
                $message->forceFill(['folder' => $action])->save();
        }
    }

    /** Apply or remove one label on one message. */
    public function setLabel(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'uuid'],
            'applied' => ['required', 'boolean'],
        ]);

        $message = $this->findMessage($request, $uuid);

        $label = MailLabel::where('user_id', $request->user()->id)
            ->where('uuid', $data['label'])
            ->firstOrFail();

        Mailbox::provider($message->account)
            ->setLabel($message->remote_id, $label->remote_id, $data['applied']);

        $data['applied']
            ? $message->labels()->syncWithoutDetaching([$label->id])
            : $message->labels()->detach($label->id);

        return response()->json(['message' => $message->fresh('labels')->toRow()]);
    }

    /** Send a message, optionally consuming a draft. */
    public function send(Request $request): JsonResponse
    {
        $data = $request->validate([
            'to' => ['required', 'array', 'min:1'],
            'to.*.email' => ['required', 'email'],
            'to.*.name' => ['sometimes', 'nullable', 'string', 'max:200'],
            'cc' => ['sometimes', 'array'],
            'cc.*.email' => ['required', 'email'],
            'bcc' => ['sometimes', 'array'],
            'bcc.*.email' => ['required', 'email'],
            'subject' => ['sometimes', 'nullable', 'string', 'max:998'],
            'bodyHtml' => ['sometimes', 'nullable', 'string'],
            'draftId' => ['sometimes', 'nullable', 'string', 'uuid'],
            'inReplyTo' => ['sometimes', 'nullable', 'string', 'uuid'],
        ]);

        $account = Mailbox::requireAccountFor($request->user());
        $provider = Mailbox::provider($account);

        $payload = [
            'to' => $data['to'],
            'cc' => $data['cc'] ?? [],
            'bcc' => $data['bcc'] ?? [],
            'subject' => $data['subject'] ?? '',
            'bodyHtml' => $data['bodyHtml'] ?? '',
        ];

        // Threading: a reply must carry the original's provider ids or it
        // arrives as a new conversation.
        if ($replyUuid = $data['inReplyTo'] ?? null) {
            $original = $this->findMessage($request, $replyUuid);
            $payload['threadId'] = $original->thread_id;
            $payload['messageId'] = $original->remote_id;
        }

        $provider->send($payload);

        if ($draftUuid = $data['draftId'] ?? null) {
            $draft = MailDraft::where('user_id', $request->user()->id)
                ->where('uuid', $draftUuid)
                ->first();

            if ($draft) {
                // The provider turned the draft into a sent message; drop the
                // local copy so it stops showing in Drafts.
                if ($draft->remote_id && $account->provider === 'google') {
                    rescue(fn () => $provider->deleteDraft($draft->remote_id), report: false);
                }

                $draft->delete();
            }
        }

        SyncMailbox::dispatch($account);

        return response()->json(['sent' => true]);
    }

    public function drafts(Request $request): JsonResponse
    {
        return response()->json([
            'drafts' => MailDraft::where('user_id', $request->user()->id)
                ->latest('updated_at')
                ->get()
                ->map->toRecord()
                ->values(),
        ]);
    }

    /** Autosave. Creates on first call, updates thereafter. */
    public function saveDraft(Request $request): JsonResponse
    {
        $data = $request->validate([
            'id' => ['sometimes', 'nullable', 'string', 'uuid'],
            'to' => ['sometimes', 'array'],
            'cc' => ['sometimes', 'array'],
            'bcc' => ['sometimes', 'array'],
            'subject' => ['sometimes', 'nullable', 'string', 'max:998'],
            'bodyHtml' => ['sometimes', 'nullable', 'string'],
            'mode' => ['sometimes', 'string', 'in:new,reply,reply-all,forward'],
            'inReplyTo' => ['sometimes', 'nullable', 'string'],
            'threadId' => ['sometimes', 'nullable', 'string'],
        ]);

        $account = Mailbox::requireAccountFor($request->user());

        $draft = MailDraft::firstOrNew([
            'user_id' => $request->user()->id,
            'uuid' => $data['id'] ?? (string) Str::uuid(),
        ]);

        $draft->fill([
            'connected_account_id' => $account->id,
            'to' => $data['to'] ?? [],
            'cc' => $data['cc'] ?? [],
            'bcc' => $data['bcc'] ?? [],
            'subject' => $data['subject'] ?? null,
            'body_html' => $data['bodyHtml'] ?? null,
            'mode' => $data['mode'] ?? 'new',
            'in_reply_to' => $data['inReplyTo'] ?? null,
            'thread_id' => $data['threadId'] ?? null,
        ]);

        if (! $draft->exists) {
            $draft->user_id = $request->user()->id;
        }

        $draft->save();

        return response()->json(['draft' => $draft->toRecord()]);
    }

    public function deleteDraft(Request $request, string $uuid): JsonResponse
    {
        $draft = MailDraft::where('user_id', $request->user()->id)
            ->where('uuid', $uuid)
            ->firstOrFail();

        if ($draft->remote_id) {
            rescue(
                fn () => Mailbox::provider($draft->account)->deleteDraft($draft->remote_id),
                report: false
            );
        }

        $draft->delete();

        return response()->json(['deleted' => true]);
    }

    /** Streams attachment bytes straight from the provider. */
    public function attachment(Request $request, string $uuid): SymfonyResponse
    {
        $attachment = MailAttachment::where('uuid', $uuid)->firstOrFail();
        $message = $attachment->message;

        abort_unless($message && $message->user_id === $request->user()->id, 404);

        try {
            $bytes = Mailbox::provider($message->account)
                ->getAttachment($message->remote_id, $attachment->remote_id);
        } catch (\Throwable $e) {
            logger()->error('mail: attachment download failed', [
                'attachment_uuid' => $attachment->uuid,
                'message_uuid' => $message->uuid,
                'error' => $e->getMessage(),
            ]);

            abort(502, 'This attachment could not be downloaded from the mail provider.');
        }

        $mime = $attachment->mime_type ?: 'application/octet-stream';

        // Viewing is opt-in and limited to types a browser renders safely, so
        // an attachment can be previewed instead of only downloaded. Anything
        // else always downloads rather than being handed to the browser to
        // interpret in our origin.
        //
        // SVG is the exception that has to be earned: it is a document that can
        // carry script and external references, not an inert picture, so it is
        // only served inline after being stripped down — see sanitizeSvg().
        $isSvg = $mime === 'image/svg+xml';

        $viewable = str_starts_with($mime, 'image/')
            || str_starts_with($mime, 'audio/')
            || str_starts_with($mime, 'video/')
            || $mime === 'application/pdf'
            || $mime === 'text/plain'
            || $mime === 'text/csv';

        if ($request->boolean('inline') && $viewable) {
            if ($isSvg) {
                $bytes = self::sanitizeSvg($bytes);
            }

            return response($bytes, 200, [
                'Content-Type' => $mime,
                'Content-Disposition' => 'inline; filename="'.addslashes($attachment->filename).'"',
                'Content-Security-Policy' => "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'none'; script-src 'none'",
                'X-Content-Type-Options' => 'nosniff',
                'Cache-Control' => 'private, max-age=3600',
            ]);
        }

        return response()->streamDownload(
            fn () => print ($bytes),
            $attachment->filename,
            ['Content-Type' => $mime],
        );
    }

    /**
     * The live-mail check behind the page's five-second timer.
     *
     * Kept separate from the full sync so it can never inherit its cost: one
     * inbox request, no cursor movement, and a failure that reports itself
     * without turning into a 500 on a timer.
     */
    private function quickSync(Request $request, ConnectedAccount $account): JsonResponse
    {
        try {
            $written = new MailSynchronizer($account)->quickCheck();
        } catch (MailAuthException $e) {
            // A dead grant still has to surface as the reconnect prompt, even
            // on the background timer — otherwise the mailbox silently stops
            // receiving and nothing on screen says why.
            throw $e;
        } catch (\Throwable $e) {
            logger()->warning('mail: live check failed', [
                'account' => $account->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json(['synced' => 0, 'fast' => true, 'error' => 'unavailable']);
        }

        return response()->json([
            'synced' => $written,
            'fast' => true,
            // Only worth the extra query when something actually landed.
            'folders' => $written > 0 ? $this->folderCounts($request->user()->id) : null,
        ]);
    }

    /**
     * Strip the executable parts out of an SVG so it can be previewed.
     *
     * An SVG is a document, not a picture: it can carry <script>, event
     * handlers, <foreignObject> with arbitrary HTML, and external references
     * that phone home. Served from our own origin those would run as us, so a
     * sender could get script execution just by attaching a logo. The response
     * also carries `script-src 'none'` — this is the belt to that CSP's braces,
     * because a Content-Security-Policy is only as good as the browser reading it.
     *
     * Deliberately a whitelist-shaped strip rather than a full parse: anything
     * that survives is inert markup, and a malformed SVG simply renders as
     * nothing rather than being handed through intact.
     */
    private static function sanitizeSvg(string $svg): string
    {
        // Elements that can execute, embed, or fetch.
        $svg = preg_replace(
            '#<\s*(script|foreignObject|iframe|embed|object|use|image|audio|video|animate|set|handler)\b[^>]*>.*?<\s*/\s*\1\s*>#is',
            '',
            $svg
        ) ?? '';

        // …and their self-closing forms, which the pair above cannot match.
        $svg = preg_replace(
            '#<\s*(script|foreignObject|iframe|embed|object|use|image|animate|set|handler)\b[^>]*/?>#is',
            '',
            $svg
        ) ?? '';

        // Inline event handlers: on* on any element.
        $svg = preg_replace('#\son[a-z]+\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)#is', '', $svg) ?? '';

        // javascript:/data: URLs in href, xlink:href and style.
        $svg = preg_replace(
            '#(href|xlink:href|src)\s*=\s*(?:"\s*(?:javascript|data|vbscript):[^"]*"|\'\s*(?:javascript|data|vbscript):[^\']*\')#is',
            '',
            $svg
        ) ?? '';

        // CSS can fetch too — url() in a style attribute or <style> block.
        return preg_replace('#(?:@import|expression\s*\(|url\s*\(\s*["\']?\s*(?:https?:|//|javascript:))#is', '', $svg) ?? '';
    }

    /** Manual "sync now" from the settings panel. Runs inline so the UI can report the result. */
    public function sync(Request $request): JsonResponse
    {
        $account = Mailbox::requireAccountFor($request->user());

        // The page's live-mail timer asks for the fast path: one request
        // against the inbox rather than a walk of every folder. A full pass
        // cannot run every five seconds — it is still going when the next one
        // starts — so asking for one here would defeat the point.
        if ($request->boolean('fast')) {
            return $this->quickSync($request, $account);
        }

        // The full folder walk can outlast a web request: on a large mailbox it
        // makes enough provider round trips to blow past the gateway timeout,
        // which surfaced as a 504 on every poll. Hand it to the queue instead
        // and answer immediately with the current mirror — SyncMailbox is
        // unique per mailbox, so the ~1-minute poll, the mail:sync-all
        // scheduler and the "Sync now" button all collapse into one queued run.
        // The fast path above still pulls new inbox mail in live on every tick
        // (and still surfaces a dead grant as the 409 reconnect prompt), so the
        // page stays current without blocking on the heavy pass.
        SyncMailbox::dispatch($account);

        return response()->json([
            'synced' => 0,
            'queued' => true,
            'folders' => $this->folderCounts($request->user()->id),
            'syncedAt' => $account->fresh()->mail_synced_at?->toIso8601String(),
        ]);
    }

    /** Mailbox settings: which account, and whether mail sync is on. */
    public function settings(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'accounts' => $user->connectedAccounts()
                ->get()
                ->map(fn ($account): array => [
                    'provider' => $account->provider,
                    'email' => $account->email,
                    'name' => $account->name,
                    'syncEnabled' => (bool) $account->sync_email,
                    'canWrite' => $account->canWriteMail(),
                    'status' => $account->mail_status,
                    'error' => $account->mail_error,
                    'syncedAt' => $account->mail_synced_at?->toIso8601String(),
                ])
                ->values(),
            'preferences' => $this->mailPreferences($user->preferences ?? []),
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['sometimes', 'string', 'in:google,microsoft'],
            'syncEnabled' => ['sometimes', 'boolean'],
            'preferences' => ['sometimes', 'array'],
            'preferences.signature' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'preferences.readReceipts' => ['sometimes', 'boolean'],
            'preferences.conversationView' => ['sometimes', 'boolean'],
            'preferences.previewPane' => ['sometimes', 'boolean'],
            'preferences.undoSendSeconds' => ['sometimes', 'integer', 'min:0', 'max:30'],
        ]);

        $user = $request->user();

        if (isset($data['provider'], $data['syncEnabled'])) {
            $account = $user->connectedAccounts()
                ->where('provider', $data['provider'])
                ->firstOrFail();

            $account->forceFill(['sync_email' => $data['syncEnabled']])->save();

            if ($data['syncEnabled']) {
                SyncMailbox::dispatch($account);
            }
        }

        if (isset($data['preferences'])) {
            $current = $user->preferences ?? [];
            $current['mail'] = array_merge(
                $current['mail'] ?? [],
                $this->mailPreferences($data['preferences'], raw: true),
            );

            $user->forceFill(['preferences' => $current])->save();
        }

        return $this->settings($request);
    }

    /** Mail preference defaults, kept alongside the rest in users.preferences. */
    private function mailPreferences(array $stored, bool $raw = false): array
    {
        $defaults = [
            'signature' => '',
            'readReceipts' => false,
            'conversationView' => true,
            'previewPane' => true,
            'undoSendSeconds' => 5,
        ];

        $source = $raw ? $stored : ($stored['mail'] ?? []);

        return array_merge($defaults, array_intersect_key($source, $defaults));
    }

    /**
     * Unread counts drive the sidebar badges; Drafts shows a total instead,
     * since an unread draft is not a thing.
     *
     * @return array<string, array{total: int, unread: int}>
     */
    private function folderCounts(int $userId): array
    {
        $rows = MailMessage::query()
            ->selectRaw('folder, count(*) as total, sum(case when is_read then 0 else 1 end) as unread')
            ->where('user_id', $userId)
            ->groupBy('folder')
            ->get()
            ->keyBy('folder');

        $counts = [];

        foreach (Mailbox::FOLDERS as $folder) {
            $row = $rows->get($folder);

            $counts[$folder] = [
                'total' => (int) ($row->total ?? 0),
                'unread' => (int) ($row->unread ?? 0),
            ];
        }

        return $counts;
    }

    /**
     * Provider-side search, so hits are not limited to what has synced. The
     * results are mapped back onto local rows where they exist so the UI gets
     * consistent uuids and label chips.
     *
     * @return array<int, array<string, mixed>>
     */
    private function search(Request $request, string $query): array
    {
        $account = Mailbox::requireAccountFor($request->user());

        $hits = Mailbox::provider($account)->search($query);
        $remoteIds = collect($hits)->pluck('remote_id')->filter()->all();

        $local = MailMessage::query()
            ->with('labels')
            ->where('connected_account_id', $account->id)
            ->whereIn('remote_id', $remoteIds)
            ->get()
            ->keyBy('remote_id');

        return collect($hits)
            ->map(function (array $hit) use ($local): ?array {
                $row = $local->get($hit['remote_id'] ?? '');

                // A hit we have never synced has no uuid to address it by, so
                // it is skipped rather than rendered as an unopenable row.
                return $row?->toRow();
            })
            ->filter()
            ->values()
            ->all();
    }

    private function findMessage(Request $request, string $uuid): MailMessage
    {
        return MailMessage::query()
            ->where('user_id', $request->user()->id)
            ->where('uuid', $uuid)
            ->firstOrFail();
    }
}
