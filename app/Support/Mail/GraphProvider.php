<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Microsoft Graph implementation of {@see MailProvider}.
 *
 * Where Gmail models everything as labels, Outlook has real folders, so most
 * operations here are moves rather than label edits. Three mappings are worth
 * knowing:
 *
 *  - "starred" is Outlook's follow-up flag,
 *  - "labels" are Outlook categories, which are addressed by *name* rather
 *    than by id, and
 *  - archive is a genuine folder, so archiving is a move, not a subtraction.
 */
class GraphProvider implements MailProvider
{
    private const BASE = 'https://graph.microsoft.com/v1.0/me';

    /** Directory lookups (other people), as opposed to the signed-in mailbox. */
    private const BASE_USERS = 'https://graph.microsoft.com/v1.0/users';

    /** Fields the list rows need — Graph returns the full body otherwise. */
    private const LIST_SELECT = 'id,conversationId,subject,bodyPreview,from,toRecipients,isRead,flag,hasAttachments,receivedDateTime,categories,parentFolderId';

    /** Marks a cursor as "everything after this time" rather than a delta link. */
    private const TIME_CURSOR = 'ts:';

    private function __construct(
        private readonly ConnectedAccount $account,
    ) {}

    public static function for(ConnectedAccount $account): self
    {
        return new self($account);
    }

    public function listMessages(string $folder, int $limit = 50, ?string $pageToken = null): array
    {
        // Graph hands back a full nextLink URL for paging, so a page token is
        // followed verbatim rather than rebuilt.
        $response = $pageToken
            ? $this->request()->get($pageToken)
            : $this->request()->get(self::BASE.'/mailFolders/'.self::folderId($folder).'/messages', [
                '$top' => $limit,
                '$orderby' => 'receivedDateTime desc',
                '$select' => self::LIST_SELECT,
            ]);

        $data = $this->json($response);

        return [
            'messages' => collect($data['value'] ?? [])
                ->map(fn (array $raw): array => $this->normalize($raw, $folder, withBody: false))
                ->all(),
            'cursor' => $data['@odata.nextLink'] ?? null,
        ];
    }

    public function getMessage(string $remoteId): array
    {
        // $expand pulls the attachment list in with the message itself — one
        // round trip instead of two sequential ones. That second call used to
        // cost several extra seconds on every never-before-opened message,
        // which is most of them the first time a user reads their mailbox.
        $message = $this->json($this->request()->get(self::BASE.'/messages/'.$remoteId, [
            '$expand' => 'attachments($select=id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId)',
        ]));

        $normalized = $this->normalize($message, null, withBody: true);

        // Outlook reports hasAttachments=false when a message's only
        // attachments are its embedded pictures, so a body that references
        // `cid:` still has to be asked about or those images never resolve.
        $body = ($normalized['body_html'] ?? '').($normalized['body_text'] ?? '');
        $hasCidRefs = str_contains($body, 'cid:');

        if (! ($message['hasAttachments'] ?? false) && ! $hasCidRefs) {
            return $normalized + ['attachments' => []];
        }

        // The expand should already carry the list; only fall back to the
        // dedicated endpoint on the rare message where it didn't (defensive —
        // not observed, but cheap insurance against relying on undocumented
        // Graph behaviour for every single message open).
        $attachments = isset($message['attachments'])
            ? ['value' => $message['attachments']]
            : $this->json($this->request()->get(
                self::BASE."/messages/{$remoteId}/attachments",
                ['$select' => 'id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId']
            ));

        // Outlook stamps a contentId on essentially every attachment, embedded
        // or not - it is not a signal of inlineness by itself. A contentId
        // only means "embedded" when the body's HTML actually points at it
        // with `cid:`; otherwise it is a normal file attachment (a contract, a
        // scanned ID, a utility bill) that must still show up as one. Treating
        // "has a contentId" as "is inline" hid exactly that kind of attachment.
        $htmlBody = $normalized['body_html'] ?? '';

        $normalized['attachments'] = collect($attachments['value'] ?? [])
            ->map(function (array $a) use ($htmlBody): array {
                $cid = $a['contentId'] ?? null;
                $referenced = $cid && (
                    str_contains($htmlBody, 'cid:'.$cid)
                    || str_contains($htmlBody, 'cid:'.rawurlencode($cid))
                );

                return [
                    'remote_id' => (string) $a['id'],
                    'filename' => (string) ($a['name'] ?? 'attachment'),
                    'mime_type' => self::mimeFor($a['contentType'] ?? null, $a['name'] ?? ''),
                    'size' => (int) ($a['size'] ?? 0),
                    'is_inline' => (bool) ($a['isInline'] ?? false) && $referenced,
                    'content_id' => $cid,
                ];
            })
            ->all();

        return $normalized;
    }

    public function getAttachment(string $remoteId, string $attachmentId): string
    {
        $response = $this->request()->get(
            self::BASE."/messages/{$remoteId}/attachments/{$attachmentId}/\$value"
        );

        if (! $response->successful()) {
            throw new RuntimeException('Graph attachment download failed: '.$response->status());
        }

        return $response->body();
    }

    /**
     * New mail that arrived since a timestamp, across the folders we mirror.
     *
     * This is the steady-state path. It is a plain filtered listing, so it
     * costs one small request per folder no matter how large the mailbox is.
     * The trade-off against a delta stream is that changes made in another
     * client — a deletion, or a read/flag toggle — are not reported here; the
     * next full resync reconciles those.
     *
     * @return array{messages:array<int,array<string,mixed>>, deleted:array<int,string>, cursor:string}
     */
    private function changesSinceTime(string $since): array
    {
        $messages = [];

        foreach (Mailbox::FOLDERS as $folder) {
            $response = $this->request()->get(
                self::BASE.'/mailFolders/'.self::folderId($folder).'/messages',
                [
                    '$filter' => 'receivedDateTime gt '.$since,
                    '$orderby' => 'receivedDateTime desc',
                    '$top' => 100,
                    '$select' => self::LIST_SELECT,
                ]
            );

            // A folder that rejects the filter (drafts have no receivedDateTime
            // ordering) simply contributes nothing this pass.
            if (! $response->successful()) {
                continue;
            }

            foreach ($this->json($response)['value'] ?? [] as $raw) {
                $messages[] = $this->normalize($raw, $folder, withBody: false);
            }
        }

        return [
            'messages' => $messages,
            'deleted' => [],
            'cursor' => self::TIME_CURSOR.now()->toIso8601ZuluString(),
        ];
    }

    public function changesSince(?string $cursor): array
    {
        // Starting fresh: watch from now on. Graph offers no cheap "give me a
        // delta token" for messages — a new delta streams the whole mailbox to
        // reach its token, which on a large account is thousands of requests —
        // so the cursor is a timestamp instead. History comes from the backfill.
        if (! $cursor) {
            return ['messages' => [], 'deleted' => [], 'cursor' => self::TIME_CURSOR.now()->toIso8601ZuluString()];
        }

        // Timestamp cursor: anything that arrived since we last looked.
        if (str_starts_with($cursor, self::TIME_CURSOR)) {
            return $this->changesSinceTime(substr($cursor, strlen(self::TIME_CURSOR)));
        }

        $response = $this->request()->get($cursor);

        // 410 Gone: the delta token aged out and cannot be resumed.
        if ($response->status() === 410) {
            throw new MailCursorExpiredException('Graph delta token expired; a full resync is required.');
        }

        $data = $this->json($response);

        $messages = [];
        $deleted = [];

        foreach ($data['value'] ?? [] as $raw) {
            // Removals arrive as a stub carrying only an id and this marker.
            if (isset($raw['@removed'])) {
                $deleted[] = (string) $raw['id'];

                continue;
            }

            $messages[] = $this->normalize($raw, 'inbox', withBody: false);
        }

        // Graph pages a delta across several links and only puts the
        // deltaLink on the final page; walking to it here keeps the caller
        // from having to understand Graph's paging.
        $next = $data['@odata.nextLink'] ?? null;

        while ($next) {
            $page = $this->json($this->request()->get($next));

            foreach ($page['value'] ?? [] as $raw) {
                if (isset($raw['@removed'])) {
                    $deleted[] = (string) $raw['id'];

                    continue;
                }

                $messages[] = $this->normalize($raw, 'inbox', withBody: false);
            }

            $next = $page['@odata.nextLink'] ?? null;
            $data['@odata.deltaLink'] = $page['@odata.deltaLink'] ?? ($data['@odata.deltaLink'] ?? null);
        }

        return [
            'messages' => $messages,
            'deleted' => array_values(array_unique($deleted)),
            'cursor' => $data['@odata.deltaLink'] ?? $cursor,
        ];
    }

    public function send(array $message): string
    {
        // Create-then-send rather than /sendMail, because /sendMail returns no
        // id and the sent message has to be findable afterwards.
        $draftId = $this->saveDraft($message);

        $this->json($this->request()->post(self::BASE."/messages/{$draftId}/send"));

        return $draftId;
    }

    public function saveDraft(array $draft, ?string $remoteId = null): string
    {
        $payload = [
            'subject' => (string) ($draft['subject'] ?? ''),
            'body' => [
                'contentType' => 'HTML',
                'content' => (string) ($draft['bodyHtml'] ?? ''),
            ],
            'toRecipients' => self::recipients($draft['to'] ?? []),
            'ccRecipients' => self::recipients($draft['cc'] ?? []),
            'bccRecipients' => self::recipients($draft['bcc'] ?? []),
        ];

        $response = $remoteId
            ? $this->request()->patch(self::BASE.'/messages/'.$remoteId, $payload)
            : $this->request()->post(self::BASE.'/messages', $payload);

        return (string) ($this->json($response)['id'] ?? '');
    }

    public function deleteDraft(string $remoteId): void
    {
        $this->json($this->request()->delete(self::BASE.'/messages/'.$remoteId));
    }

    public function markRead(string $remoteId, bool $read): void
    {
        $this->json($this->request()->patch(self::BASE.'/messages/'.$remoteId, [
            'isRead' => $read,
        ]));
    }

    public function star(string $remoteId, bool $starred): void
    {
        $this->json($this->request()->patch(self::BASE.'/messages/'.$remoteId, [
            'flag' => ['flagStatus' => $starred ? 'flagged' : 'notFlagged'],
        ]));
    }

    /** Outlook has no importance marker separate from the flag. */
    public function markImportant(string $remoteId, bool $important): void
    {
        // Intentionally empty — see supportsImportant().
    }

    public function supportsImportant(): bool
    {
        return false;
    }

    public function move(string $remoteId, string $folder): void
    {
        $this->json($this->request()->post(self::BASE."/messages/{$remoteId}/move", [
            'destinationId' => self::folderId($folder),
        ]));
    }

    public function delete(string $remoteId): void
    {
        $this->json($this->request()->delete(self::BASE.'/messages/'.$remoteId));
    }

    public function listLabels(): array
    {
        $data = $this->json($this->request()->get(self::BASE.'/outlook/masterCategories'));

        return collect($data['value'] ?? [])
            ->map(fn (array $category): array => [
                // Categories are applied by name, so the name is the id.
                'id' => (string) $category['displayName'],
                'name' => (string) $category['displayName'],
                'system' => false,
            ])
            ->all();
    }

    public function setLabel(string $remoteId, string $labelId, bool $applied): void
    {
        // Categories are a whole array on the message — there is no
        // add-one/remove-one call, so this is a read-modify-write.
        $current = $this->json($this->request()->get(self::BASE.'/messages/'.$remoteId, [
            '$select' => 'categories',
        ]));

        $categories = collect($current['categories'] ?? []);

        $next = $applied
            ? $categories->push($labelId)->unique()->values()
            : $categories->reject(fn (string $name): bool => $name === $labelId)->values();

        $this->json($this->request()->patch(self::BASE.'/messages/'.$remoteId, [
            'categories' => $next->all(),
        ]));
    }

    public function search(string $query, int $limit = 50): array
    {
        $response = $this->request()
            // $search requires this header, and cannot be combined with
            // $orderby — Graph sorts search hits by relevance instead.
            ->withHeaders(['ConsistencyLevel' => 'eventual'])
            ->get(self::BASE.'/messages', [
                '$search' => '"'.str_replace('"', '', $query).'"',
                '$top' => $limit,
                '$select' => self::LIST_SELECT,
            ]);

        return collect($this->json($response)['value'] ?? [])
            ->map(fn (array $raw): array => $this->normalize($raw, null, withBody: false))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    private function normalize(array $raw, ?string $folder, bool $withBody): array
    {
        $from = $raw['from']['emailAddress'] ?? [];

        $message = [
            'remote_id' => (string) ($raw['id'] ?? ''),
            'thread_id' => (string) ($raw['conversationId'] ?? ''),
            'folder' => $folder ?? 'inbox',
            'subject' => (string) ($raw['subject'] ?? ''),
            'snippet' => (string) ($raw['bodyPreview'] ?? ''),
            'from_name' => $from['name'] ?? null,
            'from_email' => $from['address'] ?? null,
            'to' => self::addresses($raw['toRecipients'] ?? []),
            'is_read' => (bool) ($raw['isRead'] ?? false),
            'is_starred' => ($raw['flag']['flagStatus'] ?? 'notFlagged') === 'flagged',
            // Outlook has no "important" concept matching Gmail's; the flag
            // already carries that meaning, so this stays false.
            'is_important' => false,
            'has_attachments' => (bool) ($raw['hasAttachments'] ?? false),
            'sent_at' => isset($raw['receivedDateTime'])
                ? strtotime((string) $raw['receivedDateTime'])
                : null,
            'label_ids' => array_values($raw['categories'] ?? []),
        ];

        if (! $withBody) {
            return $message;
        }

        $body = $raw['body'] ?? [];
        $isHtml = strtolower((string) ($body['contentType'] ?? 'html')) === 'html';

        return $message + [
            'body_html' => $isHtml ? ($body['content'] ?? null) : null,
            'body_text' => $isHtml ? null : ($body['content'] ?? null),
            'cc' => self::addresses($raw['ccRecipients'] ?? []),
            'reply_to' => $raw['replyTo'][0]['emailAddress']['address'] ?? null,
        ];
    }

    /**
     * @param  array<int, array<string, mixed>>  $list
     * @return array<int, array{name: ?string, email: ?string}>
     */
    private static function addresses(array $list): array
    {
        return collect($list)
            ->map(fn (array $entry): array => [
                'name' => $entry['emailAddress']['name'] ?? null,
                'email' => $entry['emailAddress']['address'] ?? null,
            ])
            ->filter(fn (array $address): bool => $address['email'] !== null)
            ->values()
            ->all();
    }

    /**
     * @param  array<int, mixed>  $addresses
     * @return array<int, array<string, mixed>>
     */
    private static function recipients(array $addresses): array
    {
        return collect($addresses)
            ->map(function (mixed $address): ?array {
                $email = is_string($address) ? $address : ($address['email'] ?? null);

                if (! $email) {
                    return null;
                }

                $entry = ['address' => $email];

                if (! is_string($address) && ! empty($address['name'])) {
                    $entry['name'] = $address['name'];
                }

                return ['emailAddress' => $entry];
            })
            ->filter()
            ->values()
            ->all();
    }

    /** Portal folder name to the Outlook well-known folder it lives in. */
    /**
     * Some senders' mail clients hand Outlook a generic content type for a
     * perfectly normal image, which is enough to stop the portal from
     * thumbnailing or previewing it. A well-known extension is a better guess
     * than trusting a contentType of "octet-stream" at face value.
     */
    private static function mimeFor(?string $contentType, string $filename): ?string
    {
        if ($contentType && $contentType !== 'application/octet-stream') {
            return $contentType;
        }

        return match (strtolower((string) pathinfo($filename, PATHINFO_EXTENSION))) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'pdf' => 'application/pdf',
            default => $contentType,
        };
    }

    private static function folderId(string $folder): string
    {
        return match ($folder) {
            'inbox' => 'inbox',
            'sent' => 'sentitems',
            'draft' => 'drafts',
            'spam' => 'junkemail',
            'trash' => 'deleteditems',
            'archive' => 'archive',
            default => throw new RuntimeException("Unknown mail folder '{$folder}'."),
        };
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
            MailTokens::forget($this->account);

            throw new MailAuthException('Microsoft rejected the mailbox credentials. Reconnect the account.');
        }

        if ($response->status() === 403) {
            throw new MailAuthException(
                'This Microsoft account was connected without permission to manage mail. Reconnect it to grant access.'
            );
        }

        // DELETE and some PATCH calls answer 204 with an empty body.
        if ($response->status() === 204) {
            return [];
        }

        if (! $response->successful()) {
            throw new RuntimeException(
                'Graph API error '.$response->status().': '.$response->json('error.message', 'unknown')
            );
        }

        return $response->json() ?? [];
    }

    /**
     * Message counts per folder, straight from Graph's folder metadata — one
     * request, no message enumeration. Folders Graph does not return (an
     * account with no Archive, say) are left out rather than guessed at.
     *
     * @return array<string, int>
     */
    public function folderTotals(): array
    {
        $data = $this->json($this->request()->get(
            self::BASE.'/mailFolders',
            ['$select' => 'displayName,totalItemCount', '$top' => 100]
        ));

        // Graph keys folders by well-known name in the URL but returns display
        // names, so match on the well-known id it echoes back.
        $byId = [];
        foreach ($data['value'] ?? [] as $folder) {
            $byId[mb_strtolower((string) ($folder['displayName'] ?? ''))] = (int) ($folder['totalItemCount'] ?? 0);
        }

        $display = [
            'inbox' => 'inbox',
            'sent' => 'sent items',
            'draft' => 'drafts',
            'spam' => 'junk email',
            'trash' => 'deleted items',
            'archive' => 'archive',
        ];

        $totals = [];
        foreach ($display as $folder => $name) {
            if (isset($byId[$name])) {
                $totals[$folder] = $byId[$name];
            }
        }

        return $totals;
    }

    /**
     * A colleague's profile photo from the directory. Only works for people in
     * the same tenant and only with User.ReadBasic.All granted; anything else
     * (404 no photo, 403 scope not consented) is reported as "no photo" so the
     * caller quietly falls back to initials.
     */
    public function photoFor(string $email): ?string
    {
        $response = $this->request()
            ->withHeaders(['Accept' => 'image/jpeg'])
            ->get(self::BASE_USERS.'/'.rawurlencode($email).'/photo/$value');

        if (! $response->successful() || $response->body() === '') {
            return null;
        }

        return $response->body();
    }
}
