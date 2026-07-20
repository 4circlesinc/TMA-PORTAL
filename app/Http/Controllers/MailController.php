<?php

namespace App\Http\Controllers;

use App\Jobs\SyncMailbox;
use App\Models\MailAttachment;
use App\Models\MailDraft;
use App\Models\MailLabel;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailAuthException;
use App\Support\Mail\Mailbox;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

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
            ->with('labels')
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
     * Attach a sender picture to each row. Senders who have a portal account
     * with a real photo get it; everyone else falls back to initials in the UI,
     * so nobody is given an invented avatar.
     *
     * @param  \Illuminate\Support\Collection<int, MailMessage>  $messages
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

        return $messages->map(function (MailMessage $m) use ($avatars) {
            $row = $m->toRow();
            $row['avatarUrl'] = $avatars[mb_strtolower((string) $m->from_email)] ?? null;

            return $row;
        })->values()->all();
    }

    /**
     * One message, with its body. Bodies are fetched from the provider on
     * first open and cached, so the second open is local.
     */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $message = $this->findMessage($request, $uuid);

        if ($message->body_html === null && $message->body_text === null) {
            $account = $message->account;
            $full = Mailbox::provider($account)->getMessage($message->remote_id);

            $message->forceFill([
                'body_html' => $full['body_html'] ?? null,
                'body_text' => $full['body_text'] ?? null,
                'cc' => $full['cc'] ?? $message->cc,
                'reply_to' => $full['reply_to'] ?? $message->reply_to,
                'has_attachments' => ! empty($full['attachments']),
            ])->save();

            if (! empty($full['attachments'])) {
                $message->attachments()->delete();

                foreach ($full['attachments'] as $attachment) {
                    $message->attachments()->create([
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

        return response()->json([
            'message' => $message->fresh(['labels', 'attachments'])->toRecord(),
        ]);
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
    public function attachment(Request $request, string $uuid): StreamedResponse
    {
        $attachment = MailAttachment::where('uuid', $uuid)->firstOrFail();
        $message = $attachment->message;

        abort_unless($message && $message->user_id === $request->user()->id, 404);

        $bytes = Mailbox::provider($message->account)
            ->getAttachment($message->remote_id, $attachment->remote_id);

        return response()->streamDownload(
            fn () => print($bytes),
            $attachment->filename,
            ['Content-Type' => $attachment->mime_type ?: 'application/octet-stream'],
        );
    }

    /** Manual "sync now" from the settings panel. Runs inline so the UI can report the result. */
    public function sync(Request $request): JsonResponse
    {
        $account = Mailbox::requireAccountFor($request->user());

        $written = new MailSynchronizer($account)->sync();

        return response()->json([
            'synced' => $written,
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
