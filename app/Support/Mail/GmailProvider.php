<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Gmail API implementation of {@see MailProvider}.
 *
 * Two Gmail shapes leak into everything here. First, Gmail has no folders —
 * only labels — so "archive" is the absence of INBOX rather than a place.
 * Second, list endpoints return bare ids, so every listing costs a second
 * fan-out to read headers; those go out concurrently via Http::pool.
 */
class GmailProvider implements MailProvider
{
    private const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

    /** Headers the list rows actually render. */
    private const LIST_HEADERS = ['From', 'To', 'Subject', 'Date'];

    private function __construct(
        private readonly ConnectedAccount $account,
    ) {}

    public static function for(ConnectedAccount $account): self
    {
        return new self($account);
    }

    public function listMessages(string $folder, int $limit = 50, ?string $pageToken = null): array
    {
        $query = ['maxResults' => $limit];

        if ($pageToken) {
            $query['pageToken'] = $pageToken;
        }

        // Archive is "filed away": no INBOX label, but not deleted or sent
        // either. There is no label for it, so it has to be a search.
        if ($folder === 'archive') {
            $query['q'] = '-in:inbox -in:trash -in:spam -in:sent -in:draft';
        } else {
            $query['labelIds'] = self::labelForFolder($folder);
        }

        $response = $this->request()->get(self::BASE.'/messages', $query);
        $data = $this->json($response);

        $ids = collect($data['messages'] ?? [])->pluck('id')->all();

        // The folder is derived from each message's own labels, not from the
        // query that found it. Gmail's labels are the truth, and a message can
        // legitimately come back from a query whose folder it does not belong
        // to — trusting the query would file it in the wrong place.
        return [
            'messages' => $this->hydrateList($ids, null),
            'cursor' => $data['nextPageToken'] ?? null,
        ];
    }

    public function getMessage(string $remoteId): array
    {
        $response = $this->request()->get(self::BASE.'/messages/'.$remoteId, [
            'format' => 'full',
        ]);

        return $this->normalize($this->json($response), null, withBody: true);
    }

    public function getAttachment(string $remoteId, string $attachmentId): string
    {
        $response = $this->request()->get(
            self::BASE."/messages/{$remoteId}/attachments/{$attachmentId}"
        );

        $data = $this->json($response);
        $raw = strtr((string) ($data['data'] ?? ''), '-_', '+/');

        return base64_decode($raw, true) ?: '';
    }

    public function changesSince(?string $cursor): array
    {
        // No cursor yet: this mailbox has never synced, so there is no history
        // to walk. The caller seeds it with a full listing instead.
        if (! $cursor) {
            return ['messages' => [], 'deleted' => [], 'cursor' => $this->currentHistoryId()];
        }

        $response = $this->request()->get(self::BASE.'/history', [
            'startHistoryId' => $cursor,
            'maxResults' => 500,
        ]);

        // Gmail expires history older than ~a week. A 404 means the cursor is
        // too old to resume from, so the caller must resync from scratch.
        if ($response->status() === 404) {
            throw new MailCursorExpiredException('Gmail history cursor expired; a full resync is required.');
        }

        $data = $this->json($response);

        $changed = [];
        $deleted = [];

        foreach ($data['history'] ?? [] as $entry) {
            foreach (['messagesAdded', 'labelsAdded', 'labelsRemoved'] as $key) {
                foreach ($entry[$key] ?? [] as $item) {
                    if ($id = $item['message']['id'] ?? null) {
                        $changed[$id] = true;
                    }
                }
            }

            foreach ($entry['messagesDeleted'] ?? [] as $item) {
                if ($id = $item['message']['id'] ?? null) {
                    $deleted[] = $id;
                    unset($changed[$id]);
                }
            }
        }

        return [
            'messages' => $this->hydrateList(array_keys($changed), null),
            'deleted' => array_values(array_unique($deleted)),
            'cursor' => $data['historyId'] ?? $this->currentHistoryId(),
        ];
    }

    public function send(array $message): string
    {
        $payload = ['raw' => MimeBuilder::encode(MimeBuilder::build($message))];

        // Keeping the reply in its conversation.
        if (! empty($message['threadId'])) {
            $payload['threadId'] = $message['threadId'];
        }

        $response = $this->request()->post(self::BASE.'/messages/send', $payload);

        return (string) ($this->json($response)['id'] ?? '');
    }

    public function saveDraft(array $draft, ?string $remoteId = null): string
    {
        $payload = [
            'message' => ['raw' => MimeBuilder::encode(MimeBuilder::build($draft))],
        ];

        if (! empty($draft['threadId'])) {
            $payload['message']['threadId'] = $draft['threadId'];
        }

        $response = $remoteId
            ? $this->request()->put(self::BASE.'/drafts/'.$remoteId, $payload)
            : $this->request()->post(self::BASE.'/drafts', $payload);

        return (string) ($this->json($response)['id'] ?? '');
    }

    public function deleteDraft(string $remoteId): void
    {
        $this->json($this->request()->delete(self::BASE.'/drafts/'.$remoteId));
    }

    public function markRead(string $remoteId, bool $read): void
    {
        $this->modify($remoteId, $read ? [] : ['UNREAD'], $read ? ['UNREAD'] : []);
    }

    public function star(string $remoteId, bool $starred): void
    {
        $this->modify($remoteId, $starred ? ['STARRED'] : [], $starred ? [] : ['STARRED']);
    }

    public function markImportant(string $remoteId, bool $important): void
    {
        $this->modify($remoteId, $important ? ['IMPORTANT'] : [], $important ? [] : ['IMPORTANT']);
    }

    public function supportsImportant(): bool
    {
        return true;
    }

    public function move(string $remoteId, string $folder): void
    {
        // Trash has a dedicated endpoint; label juggling does not move a
        // message there the way the Gmail UI does.
        if ($folder === 'trash') {
            $this->json($this->request()->post(self::BASE."/messages/{$remoteId}/trash"));

            return;
        }

        match ($folder) {
            // Archiving is removing INBOX, nothing more.
            'archive' => $this->modify($remoteId, [], ['INBOX', 'SPAM', 'TRASH']),
            'inbox' => $this->modify($remoteId, ['INBOX'], ['SPAM', 'TRASH']),
            'spam' => $this->modify($remoteId, ['SPAM'], ['INBOX']),
            default => throw new RuntimeException("Cannot move a Gmail message to '{$folder}'."),
        };
    }

    public function delete(string $remoteId): void
    {
        $this->json($this->request()->delete(self::BASE.'/messages/'.$remoteId));
    }

    public function listLabels(): array
    {
        $data = $this->json($this->request()->get(self::BASE.'/labels'));

        return collect($data['labels'] ?? [])
            ->map(fn (array $label): array => [
                'id' => (string) $label['id'],
                'name' => (string) $label['name'],
                'system' => ($label['type'] ?? 'user') === 'system',
            ])
            ->all();
    }

    public function setLabel(string $remoteId, string $labelId, bool $applied): void
    {
        $this->modify($remoteId, $applied ? [$labelId] : [], $applied ? [] : [$labelId]);
    }

    public function search(string $query, int $limit = 50): array
    {
        $data = $this->json($this->request()->get(self::BASE.'/messages', [
            'q' => $query,
            'maxResults' => $limit,
        ]));

        return $this->hydrateList(collect($data['messages'] ?? [])->pluck('id')->all(), null);
    }

    /**
     * Reads headers for a batch of ids concurrently. Gmail's list endpoints
     * only return ids, so without this a 50-row inbox would be 50 serial
     * round trips.
     *
     * @param  array<int, string>  $ids
     * @return array<int, array<string, mixed>>
     */
    private function hydrateList(array $ids, ?string $folder): array
    {
        if ($ids === []) {
            return [];
        }

        $token = MailTokens::accessToken($this->account);

        $responses = Http::pool(fn ($pool) => collect($ids)->map(
            fn (string $id) => $pool->withToken($token)
                ->get(self::BASE.'/messages/'.$id, [
                    'format' => 'metadata',
                    'metadataHeaders' => self::LIST_HEADERS,
                ])
        )->all());

        $messages = [];

        foreach ($responses as $response) {
            // One unreadable message should not empty the whole inbox.
            if (! is_object($response) || ! method_exists($response, 'successful') || ! $response->successful()) {
                continue;
            }

            $messages[] = $this->normalize($response->json(), $folder, withBody: false);
        }

        return $messages;
    }

    /**
     * Flattens Gmail's payload into the portal's message shape.
     *
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    private function normalize(array $raw, ?string $folder, bool $withBody): array
    {
        $labels = $raw['labelIds'] ?? [];
        $headers = $this->headers($raw['payload']['headers'] ?? []);
        $from = self::parseAddress($headers['from'] ?? '');

        $message = [
            'remote_id' => (string) ($raw['id'] ?? ''),
            'thread_id' => (string) ($raw['threadId'] ?? ''),
            'folder' => $folder ?? self::folderForLabels($labels),
            'subject' => $headers['subject'] ?? '',
            'snippet' => html_entity_decode((string) ($raw['snippet'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            'from_name' => $from['name'],
            'from_email' => $from['email'],
            'to' => self::parseAddressList($headers['to'] ?? ''),
            'is_read' => ! in_array('UNREAD', $labels, true),
            'is_starred' => in_array('STARRED', $labels, true),
            'is_important' => in_array('IMPORTANT', $labels, true),
            // Gmail's internalDate is epoch milliseconds, and it is more
            // reliable than the Date header, which the sender controls.
            'sent_at' => isset($raw['internalDate'])
                ? (int) ((int) $raw['internalDate'] / 1000)
                : null,
            'label_ids' => array_values(array_filter(
                $labels,
                fn (string $id): bool => ! str_starts_with($id, 'CATEGORY_') && ! in_array($id, [
                    'INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT',
                ], true),
            )),
        ];

        if (! $withBody) {
            $message['has_attachments'] = false;

            return $message;
        }

        $parts = self::walkParts($raw['payload'] ?? []);

        return $message + [
            'body_html' => $parts['html'],
            'body_text' => $parts['text'],
            'cc' => self::parseAddressList($headers['cc'] ?? ''),
            'reply_to' => $headers['reply-to'] ?? null,
            'attachments' => self::resolveInlineAttachments($parts['attachments'], $parts['html']),
            'has_attachments' => $parts['attachments'] !== [],
        ];
    }

    /**
     * Gmail stamps a Content-ID on essentially every attachment, embedded or
     * not - it is not a signal of inlineness by itself (mirrors the same fix
     * already in GraphProvider). A Content-ID only means "embedded" when the
     * body's HTML actually points at it with `cid:`; otherwise it is a normal
     * file attachment (a contract, a scanned ID, a utility bill) that must
     * still show up as one. Treating "has a Content-ID" as "is inline" hid
     * exactly that kind of attachment.
     *
     * @param  array<int, array<string, mixed>>  $attachments
     */
    private static function resolveInlineAttachments(array $attachments, ?string $html): array
    {
        return array_map(function (array $a) use ($html) {
            $cid = $a['content_id'];
            $referenced = $cid && $html && (
                str_contains($html, 'cid:'.$cid)
                || str_contains($html, 'cid:'.rawurlencode($cid))
            );

            $a['is_inline'] = $a['is_inline'] || $referenced;

            return $a;
        }, $attachments);
    }

    /**
     * Walks the MIME tree for bodies and attachments. Gmail nests parts
     * arbitrarily deep (multipart/alternative inside multipart/mixed, and so
     * on), so this recurses rather than assuming a shape.
     *
     * @param  array<string, mixed>  $part
     * @return array{html: ?string, text: ?string, attachments: array<int, array<string, mixed>>}
     */
    private static function walkParts(array $part, array $carry = ['html' => null, 'text' => null, 'attachments' => []]): array
    {
        $mime = $part['mimeType'] ?? '';
        $filename = $part['filename'] ?? '';
        $body = $part['body'] ?? [];

        if ($filename !== '' && ! empty($body['attachmentId'])) {
            $headers = collect($part['headers'] ?? [])
                ->mapWithKeys(fn (array $h): array => [strtolower((string) $h['name']) => (string) $h['value']]);

            $contentId = trim((string) $headers->get('content-id', ''), '<>');

            $carry['attachments'][] = [
                'remote_id' => (string) $body['attachmentId'],
                'filename' => $filename,
                'mime_type' => $mime,
                'size' => (int) ($body['size'] ?? 0),
                // Inline images belong to the body, not the attachment strip.
                // A bare Content-ID is not enough on its own - see
                // resolveInlineAttachments(), which checks whether the body
                // actually embeds it.
                'is_inline' => str_contains(strtolower((string) $headers->get('content-disposition', '')), 'inline'),
                'content_id' => $contentId ?: null,
            ];
        } elseif (! empty($body['data'])) {
            $decoded = base64_decode(strtr((string) $body['data'], '-_', '+/'), true) ?: '';

            // Keep the first of each kind: the outermost alternative is the
            // one the sender meant as primary.
            if ($mime === 'text/html' && $carry['html'] === null) {
                $carry['html'] = $decoded;
            } elseif ($mime === 'text/plain' && $carry['text'] === null) {
                $carry['text'] = $decoded;
            }
        }

        foreach ($part['parts'] ?? [] as $child) {
            $carry = self::walkParts($child, $carry);
        }

        return $carry;
    }

    /**
     * @param  array<int, array<string, string>>  $headers
     * @return array<string, string>
     */
    private function headers(array $headers): array
    {
        $out = [];

        foreach ($headers as $header) {
            $out[strtolower((string) ($header['name'] ?? ''))] = (string) ($header['value'] ?? '');
        }

        return $out;
    }

    /** @return array{name: ?string, email: ?string} */
    private static function parseAddress(string $value): array
    {
        $value = trim($value);

        if ($value === '') {
            return ['name' => null, 'email' => null];
        }

        if (preg_match('/^(.*?)\s*<([^>]+)>$/', $value, $matches)) {
            return [
                'name' => trim($matches[1], " \t\"") ?: null,
                'email' => trim($matches[2]),
            ];
        }

        return ['name' => null, 'email' => $value];
    }

    /** @return array<int, array{name: ?string, email: ?string}> */
    private static function parseAddressList(string $value): array
    {
        if (trim($value) === '') {
            return [];
        }

        // Split on commas that are not inside a quoted display name.
        $parts = preg_split('/,(?=(?:[^"]*"[^"]*")*[^"]*$)/', $value) ?: [];

        return collect($parts)
            ->map(fn (string $part): array => self::parseAddress($part))
            ->filter(fn (array $address): bool => $address['email'] !== null)
            ->values()
            ->all();
    }

    /** @param array<int, string> $labels */
    private static function folderForLabels(array $labels): string
    {
        foreach (['TRASH' => 'trash', 'SPAM' => 'spam', 'DRAFT' => 'draft', 'SENT' => 'sent', 'INBOX' => 'inbox'] as $label => $folder) {
            if (in_array($label, $labels, true)) {
                return $folder;
            }
        }

        // Not in any system folder means it was archived.
        return 'archive';
    }

    private static function labelForFolder(string $folder): string
    {
        return match ($folder) {
            'inbox' => 'INBOX',
            'sent' => 'SENT',
            'draft' => 'DRAFT',
            'spam' => 'SPAM',
            'trash' => 'TRASH',
            default => throw new RuntimeException("Unknown mail folder '{$folder}'."),
        };
    }

    /**
     * @param  array<int, string>  $add
     * @param  array<int, string>  $remove
     */
    private function modify(string $remoteId, array $add, array $remove): void
    {
        if ($add === [] && $remove === []) {
            return;
        }

        $this->json($this->request()->post(self::BASE."/messages/{$remoteId}/modify", [
            'addLabelIds' => $add,
            'removeLabelIds' => $remove,
        ]));
    }

    private function currentHistoryId(): ?string
    {
        $data = $this->json($this->request()->get(self::BASE.'/profile'));

        return isset($data['historyId']) ? (string) $data['historyId'] : null;
    }

    private function request(): PendingRequest
    {
        return Http::withToken(MailTokens::accessToken($this->account))
            ->timeout(30)
            ->retry(2, 200, throw: false);
    }

    /**
     * @return array<string, mixed>
     */
    private function json(Response $response): array
    {
        if ($response->status() === 401) {
            // The cached access token went stale early; drop it so the next
            // call re-mints one instead of failing the same way.
            MailTokens::forget($this->account);

            throw new MailAuthException('Google rejected the mailbox credentials. Reconnect the account.');
        }

        if ($response->status() === 403) {
            $reason = $response->json('error.errors.0.reason', '');

            if (in_array($reason, ['insufficientPermissions', 'forbidden'], true)) {
                throw new MailAuthException(
                    'This Google account was connected without permission to manage mail. Reconnect it to grant access.'
                );
            }
        }

        if (! $response->successful()) {
            throw new RuntimeException(
                'Gmail API error '.$response->status().': '.$response->json('error.message', 'unknown')
            );
        }

        return $response->json() ?? [];
    }

    /**
     * Message counts per folder from Gmail's label metadata — one small request
     * per label. Gmail has no Archive label, so that folder is simply absent.
     *
     * @return array<string, int>
     */
    public function folderTotals(): array
    {
        $totals = [];

        foreach (['inbox', 'sent', 'draft', 'spam', 'trash'] as $folder) {
            $response = $this->request()->get(self::BASE.'/labels/'.self::labelForFolder($folder));

            if (! $response->successful()) {
                continue;
            }

            $totals[$folder] = (int) ($this->json($response)['messagesTotal'] ?? 0);
        }

        return $totals;
    }

    /**
     * Gmail exposes no directory photo lookup for arbitrary senders, so there
     * is nothing honest to return here — the UI draws initials instead.
     */
    public function photoFor(string $email): ?string
    {
        return null;
    }
}
