<?php

namespace App\Support\Mail;

/**
 * Empty compose windows and the Outlook/Gmail drafts they used to mint.
 *
 * Opening New Email seeds the signature, which is not a message. Saving that
 * to the provider made Drafts fill with sender-less rows whose preview is
 * only the disclaimer. This decides when a draft has anything worth keeping.
 */
final class DraftContent
{
    /**
     * No recipient, no subject, and a body that is empty or only a signature.
     *
     * @param  array<string, mixed>  $draft
     * @param  string|array<int, string>  $signatures
     */
    public static function isBlank(array $draft, string|array $signatures = ''): bool
    {
        if (self::hasRecipients($draft['to'] ?? [])
            || self::hasRecipients($draft['cc'] ?? [])
            || self::hasRecipients($draft['bcc'] ?? [])) {
            return false;
        }

        if (trim((string) ($draft['subject'] ?? '')) !== '') {
            return false;
        }

        $html = (string) ($draft['bodyHtml'] ?? $draft['body_html'] ?? '');
        $fallback = (string) ($draft['snippet'] ?? $draft['body_text'] ?? '');

        return ! self::bodyHasSubstance($html !== '' ? $html : $fallback, $signatures);
    }

    /**
     * A mirrored Drafts-folder row that should not appear in the list.
     *
     * @param  array<string, mixed>  $message
     * @param  string|array<int, string>  $signatures
     */
    public static function isHusk(array $message, string|array $signatures = ''): bool
    {
        if (($message['folder'] ?? '') !== 'draft') {
            return false;
        }

        return self::isBlank($message, $signatures);
    }

    /**
     * @param  string|array<int, string>  $signatures
     */
    public static function bodyHasSubstance(string $html, string|array $signatures = ''): bool
    {
        $stripped = self::plain(self::stripSignatureMarkup($html));
        $text = $stripped !== '' ? $stripped : self::plain($html);

        if ($text === '' || self::looksLikeBoilerplate($text)) {
            return false;
        }

        foreach (self::signatureList($signatures) as $signature) {
            $sig = self::plain($signature);
            if ($sig === '') {
                continue;
            }
            if ($text === $sig) {
                return false;
            }
            // Graph truncates bodyPreview; either side may be the shorter one.
            if (str_starts_with($sig, $text) || str_starts_with($text, $sig)) {
                return false;
            }
            if (mb_strlen($text) >= 20 && (str_contains($sig, $text) || str_contains($text, $sig))) {
                return false;
            }
        }

        return true;
    }

    /**
     * Display names that leaked as the literal word "null" from JSON/PHP.
     */
    public static function cleanName(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);
        if ($value === '' || strcasecmp($value, 'null') === 0 || strcasecmp($value, 'undefined') === 0) {
            return null;
        }

        return $value;
    }

    /**
     * Signature HTML stored under the user's mail preferences.
     *
     * @param  array<string, mixed>  $preferences  Full user preferences or the `mail` key
     * @return list<string>
     */
    public static function signaturesFromPreferences(array $preferences): array
    {
        $mail = isset($preferences['mail']) && is_array($preferences['mail'])
            ? $preferences['mail']
            : $preferences;

        $out = [];
        if (! empty($mail['signature']) && is_string($mail['signature'])) {
            $out[] = $mail['signature'];
        }
        foreach ($mail['signatures'] ?? [] as $entry) {
            if (is_array($entry) && ! empty($entry['html']) && is_string($entry['html'])) {
                $out[] = $entry['html'];
            }
        }

        return array_values(array_unique($out));
    }

    public static function plain(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }

        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return trim($text);
    }

    private static function stripSignatureMarkup(string $html): string
    {
        $html = preg_replace('/<div[^>]*data-email-signature[^>]*>.*?<\/div>/is', '', $html) ?? $html;
        $html = preg_replace('/<div[^>]*gmail_signature[^>]*>.*?<\/div>/is', '', $html) ?? $html;
        $html = preg_replace('/<div[^>]*id=["\']Signature["\'][^>]*>.*?<\/div>/is', '', $html) ?? $html;

        return $html;
    }

    /**
     * @param  string|array<int, string>  $signatures
     * @return list<string>
     */
    private static function signatureList(string|array $signatures): array
    {
        if (is_string($signatures)) {
            return $signatures === '' ? [] : [$signatures];
        }

        return array_values(array_filter($signatures, fn (mixed $s): bool => is_string($s) && $s !== ''));
    }

    private static function hasRecipients(mixed $list): bool
    {
        if (! is_array($list) || $list === []) {
            return false;
        }

        foreach ($list as $entry) {
            $email = is_string($entry) ? $entry : (is_array($entry) ? ($entry['email'] ?? null) : null);
            if (is_string($email) && str_contains($email, '@')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Legal footers and empty "Kind Regards," trailers that Outlook treats as
     * a body when the user has not written anything.
     */
    private static function looksLikeBoilerplate(string $text): bool
    {
        $lower = mb_strtolower($text);
        $lower = preg_replace(
            '/\b(kind regards|best regards|best wishes|sincerely|thank you|thanks|regards)\b[,!.]*/u',
            '',
            $lower
        ) ?? $lower;
        $lower = trim(preg_replace('/\s+/u', ' ', $lower) ?? $lower);

        if ($lower === '') {
            return true;
        }

        return str_contains($lower, 'this electronic mail')
            || (str_contains($lower, 'confidential') && str_contains($lower, 'intended recipient'))
            || str_contains($lower, 'get outlook for');
    }
}
