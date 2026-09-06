<?php

namespace App\Support\Security;

use Illuminate\Support\Facades\Crypt;

/**
 * Field-level encryption for identity numbers and dates of birth.
 *
 * Ciphertext lives in the original column. A HMAC lookup column is what SQL
 * may match on (duplicate detection, exact search). Age rules still run in
 * PHP after decrypt. Legacy plaintext rows keep working: open() returns them
 * unchanged until the next save seals them.
 */
final class IdentityFields
{
    public static function seal(?string $plain): ?string
    {
        if ($plain === null || $plain === '') {
            return null;
        }
        if (self::isSealed($plain)) {
            return $plain;
        }

        return Crypt::encryptString($plain);
    }

    public static function open(?string $stored): ?string
    {
        if ($stored === null || $stored === '') {
            return null;
        }
        if (! self::isSealed($stored)) {
            return $stored;
        }

        try {
            return Crypt::decryptString($stored);
        } catch (\Throwable) {
            return $stored;
        }
    }

    public static function lookup(?string $plain): ?string
    {
        $normalized = self::normalize($plain);
        if ($normalized === '') {
            return null;
        }

        return hash_hmac('sha256', $normalized, self::lookupKey());
    }

    public static function normalize(?string $value): string
    {
        return mb_strtolower(preg_replace('/\s+/', '', trim((string) $value)) ?? '');
    }

    public static function isSealed(?string $value): bool
    {
        if ($value === null || strlen($value) < 40) {
            return false;
        }

        return str_starts_with($value, 'eyJ');
    }

    private static function lookupKey(): string
    {
        return hash('sha256', (string) config('app.key').'|identity-lookup', true);
    }
}
