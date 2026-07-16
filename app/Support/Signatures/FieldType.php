<?php

namespace App\Support\Signatures;

/**
 * The field types that can be placed on a document.
 *
 * AUTOFILLED types are answered from what we already know about the recipient
 * at signing time, so the signer never types them and they are never "empty"
 * in a way that could block completion. The rest need input.
 */
class FieldType
{
    public const SIGNATURE = 'signature';

    public const INITIALS = 'initials';

    public const NAME = 'name';

    public const EMAIL = 'email';

    public const DATE = 'date';

    public const TEXT = 'text';

    public const CHECKBOX = 'checkbox';

    public const ALL = [
        self::SIGNATURE, self::INITIALS, self::NAME, self::EMAIL,
        self::DATE, self::TEXT, self::CHECKBOX,
    ];

    /** Filled from the recipient record / signing timestamp, not by typing. */
    public const AUTOFILLED = [self::NAME, self::EMAIL, self::DATE];

    private const LABELS = [
        self::SIGNATURE => 'Signature',
        self::INITIALS => 'Initials',
        self::NAME => 'Full name',
        self::EMAIL => 'Email',
        self::DATE => 'Date signed',
        self::TEXT => 'Text',
        self::CHECKBOX => 'Checkbox',
    ];

    public static function label(string $type): string
    {
        return self::LABELS[$type] ?? ucfirst($type);
    }

    public static function isValid(string $type): bool
    {
        return in_array($type, self::ALL, true);
    }

    public static function isAutofilled(string $type): bool
    {
        return in_array($type, self::AUTOFILLED, true);
    }
}
