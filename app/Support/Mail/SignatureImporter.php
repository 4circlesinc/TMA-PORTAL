<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use App\Models\MailAttachment;
use App\Models\MailMessage;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * Pulls the user's outbound email signature into the portal.
 *
 * Gmail can expose the configured signature when the account was granted
 * `gmail.settings.basic`. Graph has no signature-read API, so Outlook import
 * opens a reply draft (which Outlook stamps with the roaming signature),
 * copies that block, and deletes the draft without sending. Sent mail is
 * the fallback when that is not possible.
 */
class SignatureImporter
{
    public const MAX_LENGTH = 2_000_000;

    private const ALLOWED_TAGS = [
        'a', 'b', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'hr',
        'i', 'img', 'li', 'ol', 'p', 'span', 'strong', 'table', 'tbody', 'td',
        'th', 'thead', 'tr', 'u', 'ul',
    ];

    private const STRIPPED_SUBTREES = [
        'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
        'button', 'textarea', 'select', 'svg', 'math', 'link', 'meta',
    ];

    /** @var array<string, list<string>> */
    private const ALLOWED_ATTRIBUTES = [
        'a' => ['href', 'title'],
        'img' => ['src', 'alt', 'width', 'height'],
        'td' => ['colspan', 'rowspan', 'width', 'height', 'align', 'valign'],
        'th' => ['colspan', 'rowspan', 'width', 'height', 'align', 'valign'],
        'table' => ['width', 'cellpadding', 'cellspacing', 'border', 'align'],
        'font' => ['color', 'face', 'size'],
        'div' => ['align'],
        'p' => ['align'],
        'span' => [],
        'hr' => ['width', 'size'],
    ];

    public function __construct(
        private readonly ConnectedAccount $account,
    ) {}

    public static function for(ConnectedAccount $account): self
    {
        return new self($account);
    }

    /**
     * Best available signature HTML for this mailbox, or null when nothing
     * usable could be found.
     */
    public function import(): ?string
    {
        $raw = $this->fromProviderSettings() ?? $this->fromSentMail();

        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        $clean = $this->sanitize($raw);

        if ($clean === '' || ! $this->looksLikeSignature($clean)) {
            return null;
        }

        return Str::limit($clean, self::MAX_LENGTH, '');
    }

    private function fromProviderSettings(): ?string
    {
        return match ($this->account->provider) {
            'google' => $this->fromGmailSendAs(),
            'microsoft' => $this->fromOutlookReplyDraft(),
            default => null,
        };
    }

    /**
     * Ask Outlook for the signature it would put on a reply.
     *
     * createReply is the compose pipeline; scraping Sent mail is not, and a
     * reply's quoted #Signature belongs to the other person.
     */
    private function fromOutlookReplyDraft(): ?string
    {
        $provider = Mailbox::provider($this->account);
        if (! $provider instanceof GraphProvider) {
            return null;
        }

        foreach ($this->signatureSeedIds() as $seed) {
            $draftId = $provider->createReplyDraft($seed);
            if ($draftId === null) {
                continue;
            }

            try {
                $full = $provider->getMessage($draftId);
            } catch (Throwable) {
                $this->forgetReplyDraft($provider, $draftId);

                continue;
            }

            $html = (string) ($full['body_html'] ?? '');
            $extracted = $this->extractFromBody($html);

            if (! is_string($extracted) || trim($extracted) === '') {
                $this->forgetReplyDraft($provider, $draftId);

                continue;
            }

            $scratch = new MailMessage([
                'remote_id' => $draftId,
                'user_id' => $this->account->user_id,
                'connected_account_id' => $this->account->id,
                'folder' => 'draft',
                'body_html' => $html,
            ]);
            $this->applyProviderBody($scratch, $full);
            $resolved = $this->resolveInlineImages($extracted, $scratch);
            $this->forgetReplyDraft($provider, $draftId);

            return $resolved;
        }

        return null;
    }

    private function forgetReplyDraft(GraphProvider $provider, string $draftId): void
    {
        try {
            $provider->deleteDraft($draftId);
        } catch (Throwable) {
            // The draft is unused; a leftover in Outlook Drafts is recoverable.
        }
    }

    /** @return list<string> */
    private function signatureSeedIds(): array
    {
        $ids = MailMessage::query()
            ->where('connected_account_id', $this->account->id)
            ->whereIn('folder', ['sent', 'inbox'])
            ->whereNotNull('remote_id')
            ->orderByRaw("case when folder = 'sent' then 0 else 1 end")
            ->orderByDesc('sent_at')
            ->limit(5)
            ->pluck('remote_id')
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($ids !== []) {
            return $ids;
        }

        $provider = Mailbox::provider($this->account);

        foreach (['sent', 'inbox'] as $folder) {
            try {
                $page = $provider->listMessages($folder, 3);
            } catch (Throwable) {
                continue;
            }

            foreach ($page['messages'] ?? [] as $row) {
                $id = (string) ($row['remote_id'] ?? '');
                if ($id !== '') {
                    $ids[] = $id;
                }
            }

            if ($ids !== []) {
                break;
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * Gmail's configured signature for the primary send-as alias.
     *
     * Needs `gmail.settings.basic`. Without that scope the call is skipped —
     * asking for a 403 on every import is wasted round-trips for every account
     * connected with today's mail scopes.
     */
    private function fromGmailSendAs(): ?string
    {
        $scopes = collect($this->account->scopes ?? []);
        $hasSettings = $scopes->contains(
            fn ($scope) => is_string($scope) && str_contains($scope, 'gmail.settings.basic')
        );

        if (! $hasSettings) {
            return null;
        }

        try {
            $token = MailTokens::accessToken($this->account);
            $response = Http::withToken($token)
                ->timeout(15)
                ->acceptJson()
                ->get('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs');

            if (! $response->successful()) {
                return null;
            }

            $aliases = collect($response->json('sendAs') ?? []);
            $primary = $aliases->firstWhere('isPrimary', true)
                ?? $aliases->firstWhere('isDefault', true)
                ?? $aliases->first();

            $signature = is_array($primary) ? ($primary['signature'] ?? null) : null;

            return is_string($signature) && trim(strip_tags($signature)) !== ''
                ? $signature
                : null;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * Lift the repeating trailer from recent Sent messages.
     *
     * One message is enough when it carries a known signature wrapper
     * (Gmail / Outlook). Across several messages the most common candidate
     * wins, so a one-off footer on a single send does not become the
     * account signature.
     *
     * Inline logos are rewritten to data-URIs before the HTML is stored —
     * raw `cid:` references (and portal attachment URLs that only work while
     * signed in) are useless inside the signature editor and when composing.
     */
    private function fromSentMail(): ?string
    {
        $messages = MailMessage::query()
            ->where('connected_account_id', $this->account->id)
            ->where('folder', 'sent')
            ->with('attachments')
            ->orderByDesc('sent_at')
            ->limit(12)
            ->get();

        $candidates = $this->candidatesFromMessages($messages);

        if ($candidates === []) {
            $this->hydrateSentBodies($messages);
            $candidates = $this->candidatesFromMessages($messages);
        }

        if ($candidates === []) {
            $candidates = $this->candidatesFromProvider();
        }

        if ($candidates === []) {
            return null;
        }

        $best = $this->pickOwnSignature($candidates);

        return $this->resolveInlineImages($best['html'], $best['message']);
    }

    /**
     * @param  Collection<int, MailMessage>  $messages
     * @return list<array{html: string, message: MailMessage}>
     */
    private function candidatesFromMessages($messages): array
    {
        $candidates = [];

        foreach ($messages as $message) {
            $html = (string) $message->body_html;
            if (trim($html) === '') {
                continue;
            }

            $candidate = $this->extractFromBody($html);

            if (is_string($candidate) && trim($candidate) !== '') {
                $candidates[] = ['html' => $candidate, 'message' => $message];
            }
        }

        return $candidates;
    }

    /**
     * Prefer the block that names this mailbox, then the one that repeats.
     * Repeating a quoted someone-else signature used to beat a less common
     * but actually-yours block.
     *
     * @param  list<array{html: string, message: MailMessage}>  $candidates
     * @return array{html: string, message: MailMessage}
     */
    private function pickOwnSignature(array $candidates): array
    {
        $ownEmail = mb_strtolower(trim((string) $this->account->email));
        $ownName = mb_strtolower(trim((string) $this->account->name));

        $groups = [];

        foreach ($candidates as $candidate) {
            $key = $this->fingerprint($candidate['html']);
            $groups[$key]['items'][] = $candidate;
            $text = mb_strtolower(html_entity_decode(strip_tags($candidate['html']), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            if ($ownEmail !== '' && str_contains($text, $ownEmail)) {
                $groups[$key]['own'] = true;
            }
            if ($ownName !== '' && mb_strlen($ownName) >= 5 && str_contains($text, $ownName)) {
                $groups[$key]['own'] = true;
            }
        }

        uasort($groups, function (array $a, array $b): int {
            $ownA = ! empty($a['own']);
            $ownB = ! empty($b['own']);
            if ($ownA !== $ownB) {
                return $ownA ? -1 : 1;
            }

            return count($b['items']) <=> count($a['items']);
        });

        $winner = reset($groups);

        return $winner['items'][0];
    }

    /**
     * Listing rows never carry a body. Import has to fetch a handful of Sent
     * messages from the provider or it finds nothing until the user has
     * opened each one in the reading pane.
     *
     * @param  Collection<int, MailMessage>  $messages
     */
    private function hydrateSentBodies($messages): void
    {
        $provider = Mailbox::provider($this->account);

        foreach ($messages as $message) {
            if (filled($message->body_html) || ! $message->remote_id) {
                continue;
            }

            try {
                $full = $provider->getMessage($message->remote_id);
            } catch (Throwable) {
                continue;
            }

            $this->applyProviderBody($message, $full);
        }
    }

    /**
     * @return list<array{html: string, message: MailMessage}>
     */
    private function candidatesFromProvider(): array
    {
        try {
            $listed = Mailbox::provider($this->account)->listMessages('sent', 8);
        } catch (Throwable) {
            return [];
        }

        $provider = Mailbox::provider($this->account);
        $candidates = [];

        foreach (array_slice($listed['messages'] ?? [], 0, 8) as $row) {
            $remoteId = (string) ($row['remote_id'] ?? '');
            if ($remoteId === '') {
                continue;
            }

            $message = MailMessage::query()
                ->where('connected_account_id', $this->account->id)
                ->where('remote_id', $remoteId)
                ->with('attachments')
                ->first();

            if (! $message) {
                $message = new MailMessage([
                    'user_id' => $this->account->user_id,
                    'connected_account_id' => $this->account->id,
                    'remote_id' => $remoteId,
                    'folder' => 'sent',
                ]);
            }

            if (! filled($message->body_html)) {
                try {
                    $full = $provider->getMessage($remoteId);
                } catch (Throwable) {
                    continue;
                }
                $this->applyProviderBody($message, $full);
            }

            $extracted = $this->extractFromBody((string) $message->body_html);
            if (is_string($extracted) && trim($extracted) !== '') {
                $candidates[] = ['html' => $extracted, 'message' => $message];
            }
        }

        return $candidates;
    }

    /** @param  array<string, mixed>  $full */
    private function applyProviderBody(MailMessage $message, array $full): void
    {
        $html = (string) ($full['body_html'] ?? '');
        if (trim($html) === '') {
            return;
        }

        $message->body_html = $html;

        if ($message->exists) {
            $message->save();
        }

        foreach ($full['attachments'] ?? [] as $attachment) {
            if (! is_array($attachment) || empty($attachment['remote_id'])) {
                continue;
            }

            $attrs = [
                'filename' => (string) ($attachment['filename'] ?? 'attachment'),
                'mime_type' => $attachment['mime_type'] ?? null,
                'size' => (int) ($attachment['size'] ?? 0),
                'is_inline' => (bool) ($attachment['is_inline'] ?? false),
                'content_id' => $attachment['content_id'] ?? null,
            ];

            if ($message->exists) {
                $existing = $message->attachments()->where('remote_id', $attachment['remote_id'])->first();
                if ($existing) {
                    $existing->fill($attrs)->save();
                } else {
                    $message->attachments()->create($attrs + [
                        'uuid' => (string) Str::uuid(),
                        'remote_id' => $attachment['remote_id'],
                    ]);
                }
            } else {
                $part = new MailAttachment($attrs + [
                    'uuid' => (string) Str::uuid(),
                    'remote_id' => $attachment['remote_id'],
                ]);
                $message->setRelation(
                    'attachments',
                    ($message->relationLoaded('attachments') ? $message->attachments : collect())->push($part)
                );
            }
        }

        if ($message->exists) {
            $message->unsetRelation('attachments');
            $message->load('attachments');
        }
    }

    /**
     * Turn signature logos into self-contained data-URIs.
     *
     * Sent mail stores logos as `cid:` parts (or, after the reading pane has
     * opened the message, as authenticated `/portal/mail/attachments/…`
     * URLs). Neither form is selectable or resizable in the signature editor,
     * and neither survives being sent from the portal to someone else.
     */
    private function resolveInlineImages(string $html, MailMessage $message): string
    {
        if (! preg_match_all('/\bsrc=("|\')([^"\']+)\1/i', $html, $matches)) {
            return $html;
        }

        $sources = array_values(array_unique($matches[2]));
        $provider = null;

        foreach ($sources as $src) {
            $src = html_entity_decode($src, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $resolved = $this->bytesForImageSrc($src, $message, $provider);

            if ($resolved === null) {
                continue;
            }

            [$bytes, $mime] = $resolved;
            $dataUri = $this->toDataUri($bytes, $mime);

            if ($dataUri === null) {
                continue;
            }

            // Prefer exact src replacement; also catch HTML-entity variants.
            $html = str_replace($src, $dataUri, $html);
            $html = str_replace(htmlspecialchars($src, ENT_QUOTES), $dataUri, $html);
        }

        return $html;
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private function bytesForImageSrc(string $src, MailMessage $message, ?MailProvider &$provider): ?array
    {
        if (str_starts_with(strtolower($src), 'data:image/')) {
            return null;
        }

        $attachment = null;

        if (str_starts_with(strtolower($src), 'cid:')) {
            $cid = rawurldecode(substr($src, 4));
            $cid = trim($cid, '<>');
            $attachment = $this->attachmentForCid($message, $cid);
        } elseif (preg_match('#/portal/mail/attachments/([0-9a-f-]{36})#i', $src, $match)) {
            $attachment = $message->attachments->firstWhere('uuid', $match[1])
                ?? MailAttachment::query()->where('uuid', $match[1])->first();
        } else {
            return null;
        }

        if (! $attachment || ! $attachment->remote_id || ! $message->remote_id) {
            return null;
        }

        try {
            $provider ??= Mailbox::provider($this->account);
            $bytes = $provider->getAttachment($message->remote_id, $attachment->remote_id);
        } catch (Throwable) {
            return null;
        }

        if ($bytes === '') {
            return null;
        }

        $mime = strtolower((string) ($attachment->mime_type ?: 'image/png'));
        if (! str_starts_with($mime, 'image/')) {
            $mime = 'image/png';
        }

        return [$bytes, $mime];
    }

    private function attachmentForCid(MailMessage $message, string $cid): ?MailAttachment
    {
        if ($cid === '') {
            return null;
        }

        return $message->attachments->first(function (MailAttachment $attachment) use ($cid) {
            $value = trim((string) $attachment->content_id, '<>');
            if ($value === '') {
                return false;
            }

            return strcasecmp($value, $cid) === 0
                || str_ends_with(mb_strtolower($cid), mb_strtolower($value))
                || str_ends_with(mb_strtolower($value), mb_strtolower($cid));
        });
    }

    private function toDataUri(string $bytes, string $mime): ?string
    {
        $mime = strtolower($mime);
        if ($mime === 'image/jpg') {
            $mime = 'image/jpeg';
        }

        // Keep the source pixels. Outlook logos are often 2× the CSS size;
        // crushing them to 320px was what made imported signatures look
        // muddy. Re-encode only when the file is enormous, the long edge
        // is past a retina-wide cap, or the type cannot live in a data URI
        // the signature sanitizer will keep (GIF, BMP, …).
        $keepAsIs = in_array($mime, ['image/png', 'image/jpeg', 'image/webp'], true);
        if (! $keepAsIs || strlen($bytes) > 500_000 || $this->imageMaxEdge($bytes) > 1600) {
            $compressed = $this->compressImage($bytes, $keepAsIs ? $mime : 'image/png');
            if ($compressed !== null) {
                [$bytes, $mime] = $compressed;
            }
        }

        if (strlen($bytes) > 1_400_000) {
            return null;
        }

        return 'data:'.$mime.';base64,'.base64_encode($bytes);
    }

    private function imageMaxEdge(string $bytes): int
    {
        if (! function_exists('getimagesizefromstring')) {
            return 0;
        }

        $info = @getimagesizefromstring($bytes);
        if (! is_array($info)) {
            return 0;
        }

        return max((int) $info[0], (int) $info[1]);
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private function compressImage(string $bytes, string $mime): ?array
    {
        if (! function_exists('imagecreatefromstring')) {
            return null;
        }

        $image = @imagecreatefromstring($bytes);
        if ($image === false) {
            return null;
        }

        $width = imagesx($image);
        $height = imagesy($image);
        if ($width < 1 || $height < 1) {
            imagedestroy($image);

            return null;
        }

        $max = 1600;
        $scale = min(1, $max / max($width, $height));
        $targetW = max(1, (int) round($width * $scale));
        $targetH = max(1, (int) round($height * $scale));

        $canvas = imagecreatetruecolor($targetW, $targetH);
        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
        imagefilledrectangle($canvas, 0, 0, $targetW, $targetH, $transparent);
        imagecopyresampled($canvas, $image, 0, 0, 0, 0, $targetW, $targetH, $width, $height);

        ob_start();
        if ($mime === 'image/png' || $mime === 'image/webp') {
            imagepng($canvas, null, 6);
            $outMime = 'image/png';
        } else {
            imagejpeg($canvas, null, 92);
            $outMime = 'image/jpeg';
        }
        $out = ob_get_clean() ?: '';
        imagedestroy($image);
        imagedestroy($canvas);

        return $out !== '' ? [$out, $outMime] : null;
    }

    private function extractFromBody(string $html): ?string
    {
        // Outlook: the author's signature is after #appendonsend; anything
        // below divRplyFwdMsg is the other person's mail. Never scan the
        // whole document for #Signature — that last match is theirs.
        if (preg_match('/<div[^>]*\bid=["\'](?:x_)?appendonsend["\']/i', $html)) {
            return $this->extractAfterAppendOnSend($html);
        }

        $html = $this->stripQuotedContent($html);

        $known = $this->extractKnownWrapper($html);
        if ($known !== null) {
            return $known;
        }

        // RFC 3676 signature delimiter, including the HTML shapes Gmail and
        // Outlook emit when the author typed "-- " on its own line.
        if (preg_match(
            '/(?:^|<br\s*\/?>|<\/p>|<p[^>]*>)\s*--\s*(?:<br\s*\/?>|<\/p>|\r?\n)([\s\S]+)$/i',
            $html,
            $match
        )) {
            return trim($match[1]);
        }

        if (preg_match('/(?:<br\s*\/?>\s*){2,}([\s\S]{1,8000})$/i', $html, $match)) {
            $tail = trim($match[1]);

            if ($this->looksLikeSignature($tail)) {
                return $tail;
            }
        }

        return null;
    }

    /**
     * Outlook's compose marker: everything after it is the signature, then
     * (on a reply) the quoted thread. Take the after-block and drop quotes.
     */
    private function extractAfterAppendOnSend(string $html): ?string
    {
        $parts = preg_split(
            '/<div[^>]*\bid=["\'](?:x_)?appendonsend["\'][^>]*>\s*(?:<\/div>)?/i',
            $html,
            2
        );

        if (! is_array($parts) || count($parts) < 2) {
            return null;
        }

        $after = $this->stripQuotedContent($parts[1]);
        $known = $this->extractKnownWrapper($after);
        if ($known !== null) {
            return $known;
        }

        $after = trim($after);

        return $after !== '' && $this->looksLikeSignature($after) ? $after : null;
    }

    /**
     * Gmail (`gmail_signature`) and Outlook (`#Signature`) wrap the block the
     * author configured. The first match is theirs; later copies live inside
     * the quoted thread and belong to someone else.
     */
    private function extractKnownWrapper(string $html): ?string
    {
        $doc = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $loaded = $doc->loadHTML(
            '<?xml encoding="UTF-8"?><div id="tma-sig-scan">'.$html.'</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NONET
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        if (! $loaded) {
            return null;
        }

        $xpath = new DOMXPath($doc);
        $notQuoted = '[not(ancestor::blockquote)]'
            .'[not(ancestor::*[contains(concat(" ", normalize-space(@class), " "), " gmail_quote ")])]'
            .'[not(ancestor::*[@id="divRplyFwdMsg" or @id="x_divRplyFwdMsg"])]';
        $queries = [
            '//*[@data-smartmail="gmail_signature"]'.$notQuoted,
            '//*[contains(concat(" ", normalize-space(@class), " "), " gmail_signature ")]'.$notQuoted,
            '//*[@id="Signature"]'.$notQuoted,
            '//*[@id="x_Signature"]'.$notQuoted,
            '//*[@id="ms-outlook-mobile-signature"]'.$notQuoted,
        ];

        foreach ($queries as $query) {
            $nodes = $xpath->query($query);

            if (! $nodes || $nodes->length === 0) {
                continue;
            }

            $node = $nodes->item(0);

            if (! $node instanceof DOMElement) {
                continue;
            }

            $markup = trim($doc->saveHTML($node) ?: '');

            if ($markup !== '') {
                return $markup;
            }
        }

        return null;
    }

    /**
     * Drop reply/forward scaffolding so a quoted previous signature is not
     * mistaken for the author's own.
     */
    private function stripQuotedContent(string $html): string
    {
        $patterns = [
            '/<div[^>]*class="[^"]*\bgmail_quote\b[^"]*"[^>]*>[\s\S]*$/i',
            '/<div[^>]*class="[^"]*\bgmail_extra\b[^"]*"[^>]*>[\s\S]*$/i',
            '/<blockquote\b[\s\S]*$/i',
            '/<div[^>]*id=["\'](?:x_)?divRplyFwdMsg["\'][^>]*>[\s\S]*$/i',
            '/<div[^>]*class="[^"]*\bOutlookMessageHeader\b[^"]*"[^>]*>[\s\S]*$/i',
            '/<hr[^>]*>\s*(?:<b>|<span[^>]*>)?\s*From:[\s\S]*$/i',
            '/-----Original Message-----[\s\S]*$/i',
            '/On .+ wrote:<br[\s\S]*$/i',
        ];

        foreach ($patterns as $pattern) {
            $html = preg_replace($pattern, '', $html) ?? $html;
        }

        return trim($html);
    }

    private function looksLikeSignature(string $html): bool
    {
        $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        if ($text === '' && ! preg_match('/<img\b/i', $html)) {
            return false;
        }

        // A whole letter that slipped through the strippers is not a signature.
        // Outlook legal footers commonly run past 800 characters; 800 used to
        // reject the real mailbox signature as if it were the message body.
        if (mb_strlen($text) > 8000) {
            return false;
        }

        if (preg_match('/\bOn .{10,80} wrote:\s*$/i', $text)) {
            return false;
        }

        if (preg_match('/^(From|Sent|To|Subject)\s*:/i', $text)) {
            return false;
        }

        return true;
    }

    private function fingerprint(string $html): string
    {
        $text = mb_strtolower(trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return sha1($text !== '' ? $text : $html);
    }

    private function sanitize(string $html): string
    {
        $html = trim($html);

        if ($html === '') {
            return '';
        }

        $doc = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $loaded = $doc->loadHTML(
            '<?xml encoding="UTF-8"?><div id="tma-sig-root">'.$html.'</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NONET
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        if (! $loaded) {
            return e(strip_tags($html));
        }

        $xpath = new DOMXPath($doc);
        $root = $xpath->query('//*[@id="tma-sig-root"]')->item(0);

        if (! $root instanceof DOMElement) {
            return '';
        }

        $this->cleanNode($root);

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child);
        }

        return trim($out);
    }

    private function cleanNode(DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $child) {
            if ($child instanceof DOMElement) {
                $this->cleanElement($child);

                continue;
            }

            if ($child->nodeType !== XML_TEXT_NODE) {
                $node->removeChild($child);
            }
        }
    }

    private function cleanElement(DOMElement $el): void
    {
        $tag = strtolower($el->nodeName);

        if (in_array($tag, self::STRIPPED_SUBTREES, true)) {
            $el->parentNode?->removeChild($el);

            return;
        }

        $this->cleanNode($el);

        if (! in_array($tag, self::ALLOWED_TAGS, true)) {
            $this->unwrap($el);

            return;
        }

        $this->filterAttributes($el, $tag);
    }

    private function unwrap(DOMElement $el): void
    {
        $parent = $el->parentNode;

        if (! $parent) {
            return;
        }

        while ($el->firstChild) {
            $parent->insertBefore($el->firstChild, $el);
        }

        $parent->removeChild($el);
    }

    private function filterAttributes(DOMElement $el, string $tag): void
    {
        $allowed = self::ALLOWED_ATTRIBUTES[$tag] ?? [];

        // Signatures lean on inline colour/spacing; keep a short style allowlist
        // on the tags that actually use it.
        $styleTags = ['div', 'span', 'p', 'td', 'th', 'table', 'font', 'a', 'img'];

        foreach (iterator_to_array($el->attributes ?? []) as $attribute) {
            $name = strtolower($attribute->nodeName);
            $value = (string) $attribute->nodeValue;

            if ($name === 'style' && in_array($tag, $styleTags, true)) {
                $safe = $this->safeStyle($value);
                $safe === ''
                    ? $el->removeAttribute($attribute->nodeName)
                    : $el->setAttribute('style', $safe);

                continue;
            }

            if (! in_array($name, $allowed, true)) {
                $el->removeAttribute($attribute->nodeName);

                continue;
            }

            if ($name === 'href' && ! $this->safeUrl($value, allowMailto: true)) {
                $el->removeAttribute($attribute->nodeName);
            }

            if ($name === 'src' && ! $this->safeUrl($value, allowMailto: false)) {
                $el->removeAttribute($attribute->nodeName);
            }
        }

        if ($tag === 'a' && $el->hasAttribute('href')) {
            $el->setAttribute('rel', 'noopener noreferrer');
            $el->setAttribute('target', '_blank');
        }
    }

    private function safeStyle(string $style): string
    {
        $kept = [];

        foreach (explode(';', $style) as $declaration) {
            $declaration = trim($declaration);

            if ($declaration === '' || ! str_contains($declaration, ':')) {
                continue;
            }

            [$property, $value] = array_map('trim', explode(':', $declaration, 2));
            $property = strtolower($property);

            if (! preg_match('/^(color|background-color|font-size|font-family|font-weight|font-style|text-align|text-decoration|line-height|letter-spacing|width|height|max-width|margin|margin-top|margin-right|margin-bottom|margin-left|padding|padding-top|padding-right|padding-bottom|padding-left|border|border-top|border-right|border-bottom|border-left|border-collapse|vertical-align|display)$/', $property)) {
                continue;
            }

            if (preg_match('/expression|javascript:|url\s*\(/i', $value)) {
                continue;
            }

            $kept[] = $property.': '.$value;
        }

        return implode('; ', $kept);
    }

    private function safeUrl(string $url, bool $allowMailto): bool
    {
        $url = trim($url);

        if ($url === '') {
            return false;
        }

        if ($allowMailto && preg_match('/^mailto:/i', $url)) {
            return true;
        }

        // Remote logos and cid: images from the original send are both common.
        if (preg_match('/^(https?:|cid:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i', $url)) {
            return ! preg_match('/^(javascript:|vbscript:|data:text)/i', $url);
        }

        return false;
    }
}
