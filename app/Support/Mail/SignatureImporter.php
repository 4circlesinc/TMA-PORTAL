<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use App\Models\MailAttachment;
use App\Models\MailMessage;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * Pulls the user's outbound email signature into the portal.
 *
 * Gmail can expose the configured signature when the account was granted
 * `gmail.settings.basic`; Microsoft Graph does not. In both cases the reliable
 * fallback is to read recent Sent mail and lift the trailing block that repeats
 * across messages, that is the signature people actually send.
 */
class SignatureImporter
{
    public const MAX_LENGTH = 100000;

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
            default => null,
        };
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
        $email = mb_strtolower(trim((string) $this->account->email));

        $messages = MailMessage::query()
            ->where('connected_account_id', $this->account->id)
            ->where('folder', 'sent')
            ->whereNotNull('body_html')
            ->where('body_html', '!=', '')
            ->when($email !== '', function ($query) use ($email) {
                $query->whereRaw('LOWER(from_email) = ?', [$email]);
            })
            ->with('attachments')
            ->orderByDesc('sent_at')
            ->limit(12)
            ->get();

        if ($messages->isEmpty()) {
            return null;
        }

        /** @var list<array{html: string, message: MailMessage}> $candidates */
        $candidates = [];

        foreach ($messages as $message) {
            $candidate = $this->extractFromBody((string) $message->body_html);

            if (is_string($candidate) && trim($candidate) !== '') {
                $candidates[] = ['html' => $candidate, 'message' => $message];
            }
        }

        if ($candidates === []) {
            return null;
        }

        $counts = [];

        foreach ($candidates as $candidate) {
            $key = $this->fingerprint($candidate['html']);
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }

        arsort($counts);
        $bestKey = array_key_first($counts);

        foreach ($candidates as $candidate) {
            if ($this->fingerprint($candidate['html']) === $bestKey) {
                return $this->resolveInlineImages($candidate['html'], $candidate['message']);
            }
        }

        return $this->resolveInlineImages($candidates[0]['html'], $candidates[0]['message']);
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
     * @param  MailProvider|null  $provider
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

            return $value !== '' && strcasecmp($value, $cid) === 0;
        });
    }

    private function toDataUri(string $bytes, string $mime): ?string
    {
        // Keep signature prefs bounded: downscale large logos before embedding.
        if (strlen($bytes) > 80_000) {
            $compressed = $this->compressImage($bytes, $mime);
            if ($compressed !== null) {
                [$bytes, $mime] = $compressed;
            }
        }

        if (strlen($bytes) > 220_000) {
            return null;
        }

        return 'data:'.$mime.';base64,'.base64_encode($bytes);
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

        $max = 320;
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
            imagejpeg($canvas, null, 82);
            $outMime = 'image/jpeg';
        }
        $out = ob_get_clean() ?: '';
        imagedestroy($image);
        imagedestroy($canvas);

        return $out !== '' ? [$out, $outMime] : null;
    }

    private function extractFromBody(string $html): ?string
    {
        $html = $this->stripQuotedContent($html);

        // Provider wrappers are authoritative when present. Regex cannot own
        // nested </div> trees, so these are read through the DOM.
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

        if (preg_match('/(?:<br\s*\/?>\s*){2,}([\s\S]{1,2500})$/i', $html, $match)) {
            $tail = trim($match[1]);

            if ($this->looksLikeSignature($tail)) {
                return $tail;
            }
        }

        return null;
    }

    /**
     * Gmail (`gmail_signature`) and Outlook (`#Signature`) wrap the block the
     * author configured. Prefer the last match, a reply can still carry an
     * older copy further up the document after quote stripping.
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
        $queries = [
            '//*[@data-smartmail="gmail_signature"]',
            '//*[contains(concat(" ", normalize-space(@class), " "), " gmail_signature ")]',
            '//*[@id="Signature"]',
        ];

        foreach ($queries as $query) {
            $nodes = $xpath->query($query);

            if (! $nodes || $nodes->length === 0) {
                continue;
            }

            $node = $nodes->item($nodes->length - 1);

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
            '/<div[^>]*id=["\']divRplyFwdMsg["\'][^>]*>[\s\S]*$/i',
            '/<div[^>]*id=["\']appendonsend["\'][^>]*>[\s\S]*$/i',
            '/<hr[^>]*>\s*(?:<b>)?From:[\s\S]*$/i',
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
        if (mb_strlen($text) > 800) {
            return false;
        }

        if (preg_match('/\bOn .{10,80} wrote:\s*$/i', $text)) {
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
        // GIF is not accepted for portal signature uploads.
        if (preg_match('/^(https?:|cid:|data:image\/(?:png|jpe?g|webp);base64,)/i', $url)) {
            return ! preg_match('/^(javascript:|vbscript:|data:text)/i', $url);
        }

        return false;
    }
}
