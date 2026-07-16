<?php

namespace App\Support\Signatures;

use App\Models\SignatureField;
use App\Models\SignatureRecipient;

/**
 * Validates and normalises what a signer submits for a field.
 *
 * Everything here is hostile input: it arrives from a public page with only a
 * bearer token behind it, so nothing is trusted for size, shape, or type.
 */
class FieldValue
{
    /** A drawn/typed/uploaded signature, base64 PNG. ~200 KB of pen strokes is plenty. */
    public const MAX_IMAGE_BYTES = 512 * 1024;

    public const MAX_TEXT_LENGTH = 500;

    /**
     * @return string|null the value to store
     *
     * @throws SendValidationException on anything malformed
     */
    public static function normalize(SignatureField $field, mixed $raw, SignatureRecipient $recipient): ?string
    {
        // Autofilled types ignore whatever the client sent: the whole point is
        // that the signer can't put someone else's name or a false date there.
        if (FieldType::isAutofilled($field->type)) {
            return match ($field->type) {
                FieldType::NAME => $recipient->name,
                FieldType::EMAIL => $recipient->email,
                FieldType::DATE => now()->format('j M Y'),
            };
        }

        if ($raw === null || $raw === '') {
            return null;
        }

        return match ($field->type) {
            FieldType::SIGNATURE, FieldType::INITIALS => self::image($raw),
            FieldType::CHECKBOX => self::checkbox($raw),
            default => self::text($raw),
        };
    }

    private static function image(mixed $raw): string
    {
        if (! is_string($raw)) {
            throw new SendValidationException('That signature could not be read.');
        }

        // Only a base64 PNG data URL. No SVG (scriptable), no remote URL (would
        // make the server fetch whatever a signer points it at).
        if (! preg_match('#^data:image/png;base64,([A-Za-z0-9+/=]+)$#', $raw, $m)) {
            throw new SendValidationException('That signature could not be read.');
        }

        if (strlen($raw) > self::MAX_IMAGE_BYTES) {
            throw new SendValidationException('That signature image is too large.');
        }

        $binary = base64_decode($m[1], true);
        if ($binary === false || $binary === '') {
            throw new SendValidationException('That signature could not be read.');
        }

        // The bytes must really be a PNG, not just claim to be in the prefix.
        if (! str_starts_with($binary, "\x89PNG\r\n\x1a\n")) {
            throw new SendValidationException('That signature could not be read.');
        }

        return $raw;
    }

    private static function checkbox(mixed $raw): ?string
    {
        return filter_var($raw, FILTER_VALIDATE_BOOLEAN) ? '1' : null;
    }

    private static function text(mixed $raw): string
    {
        if (! is_scalar($raw)) {
            throw new SendValidationException('That value could not be read.');
        }

        $value = trim((string) $raw);
        if (mb_strlen($value) > self::MAX_TEXT_LENGTH) {
            throw new SendValidationException('That value is too long.');
        }

        return $value;
    }
}
