<?php

namespace App\Support\Signatures;

use App\Models\SignatureRecipient;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

/**
 * Signing links are bearer credentials: whoever holds the URL can open the
 * document. They are therefore treated like passwords with one difference -
 * the portal has to be able to show the link again ("copy the signing link"),
 * so the token is also kept encrypted under the app key.
 *
 * - `token_hash` (SHA-256) is the lookup key. A dump of the table alone can't
 *   be replayed: you can't invert the hash into a working URL.
 * - `token_ciphertext` is the same token under APP_KEY, which lives in the
 *   environment rather than the database.
 *
 * SHA-256 rather than bcrypt on purpose: lookup must be a single indexed
 * match, and the token is 32 bytes of CSPRNG output, not a guessable secret.
 */
class SigningToken
{
    /** Long enough that guessing is hopeless, short enough to paste. */
    public const BYTES = 32;

    /** Default lifetime when the sender doesn't choose one. */
    public const DEFAULT_DAYS = 30;

    /** Issue a fresh token, returning the raw value (shown exactly once). */
    public static function issue(SignatureRecipient $recipient, ?\DateTimeInterface $expiresAt = null): string
    {
        $raw = Str::random(self::BYTES * 2);

        $recipient->forceFill([
            'token_hash' => self::hash($raw),
            'token_ciphertext' => Crypt::encryptString($raw),
            'token_expires_at' => $expiresAt,
        ])->save();

        return $raw;
    }

    public static function hash(string $raw): string
    {
        return hash('sha256', $raw);
    }

    /** Find the recipient a raw token belongs to, or null. */
    public static function resolve(string $raw): ?SignatureRecipient
    {
        // Length-guarded so a junk value can't turn into a table scan.
        if (strlen($raw) < 16 || strlen($raw) > 128) {
            return null;
        }

        return SignatureRecipient::query()
            ->where('token_hash', self::hash($raw))
            ->first();
    }

    /** Recover the raw token for display. Null once it's been revoked. */
    public static function reveal(SignatureRecipient $recipient): ?string
    {
        if (! $recipient->token_ciphertext) {
            return null;
        }

        try {
            return Crypt::decryptString($recipient->token_ciphertext);
        } catch (\Throwable) {
            // Key rotated, or the row predates encryption - the link is simply
            // no longer recoverable; the sender can resend to mint a new one.
            return null;
        }
    }

    /** Revoke a link. Clearing the hash is what actually kills access. */
    public static function revoke(SignatureRecipient $recipient): void
    {
        $recipient->forceFill([
            'token_hash' => null,
            'token_ciphertext' => null,
            'token_expires_at' => now(),
        ])->save();
    }

    public static function url(string $raw): string
    {
        return url('/sign/'.$raw);
    }
}
