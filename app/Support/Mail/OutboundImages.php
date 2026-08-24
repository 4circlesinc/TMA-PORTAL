<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use App\Models\MailAttachment;
use Throwable;

/**
 * Re-embeds mirrored mailbox images into outgoing HTML.
 *
 * When the reading pane opens a message, its embedded pictures are rewritten
 * from `cid:` to authenticated `/portal/mail/attachments/…` URLs (see
 * MailController::embedInlineImages). Quoting that message in a reply drags
 * those URLs into the outgoing body, and nobody outside the portal session
 * can load them, so the receiver sees broken images. This fetches the bytes
 * back from the provider and inlines them as data: URIs, which
 * {@see InlineImages} then converts to proper cid: inline attachments.
 */
final class OutboundImages
{
    /** A quoted logo is small; a quoted photo album should stay a link. */
    private const MAX_BYTES = 3_000_000;

    public static function embed(ConnectedAccount $account, string $html): string
    {
        if ($html === '' || ! str_contains($html, '/portal/mail/attachments/')) {
            return $html;
        }

        if (! preg_match_all(
            '/\bsrc=("|\')((?:https?:\/\/[^"\']*)?\/portal\/mail\/attachments\/([0-9a-f-]{36})[^"\']*)\1/i',
            $html,
            $matches,
            PREG_SET_ORDER
        )) {
            return $html;
        }

        $provider = null;
        $resolved = [];

        foreach ($matches as $match) {
            [, , $src, $uuid] = $match;

            if (isset($resolved[$src])) {
                continue;
            }

            $dataUri = self::dataUriFor($account, strtolower($uuid), $provider);

            if ($dataUri === null) {
                continue;
            }

            $resolved[$src] = true;
            $html = str_replace($src, $dataUri, $html);
            $html = str_replace(htmlspecialchars($src, ENT_QUOTES), $dataUri, $html);
        }

        return $html;
    }

    private static function dataUriFor(ConnectedAccount $account, string $uuid, ?MailProvider &$provider): ?string
    {
        // Scoped to the sender's own mailbox, a foreign uuid resolves to
        // nothing rather than to someone else's attachment.
        $attachment = MailAttachment::query()
            ->where('uuid', $uuid)
            ->whereHas('message', fn ($query) => $query->where('connected_account_id', $account->id))
            ->with('message')
            ->first();

        if (! $attachment || ! $attachment->remote_id || ! $attachment->message?->remote_id) {
            return null;
        }

        $mime = strtolower((string) ($attachment->mime_type ?: ''));
        if (! str_starts_with($mime, 'image/')) {
            return null;
        }

        try {
            $provider ??= Mailbox::provider($account);
            $bytes = $provider->getAttachment($attachment->message->remote_id, $attachment->remote_id);
        } catch (Throwable) {
            return null;
        }

        if ($bytes === '' || strlen($bytes) > self::MAX_BYTES) {
            return null;
        }

        return 'data:'.$mime.';base64,'.base64_encode($bytes);
    }
}
