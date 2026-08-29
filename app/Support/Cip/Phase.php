<?php

namespace App\Support\Cip;

/**
 * Which workflow lane an application sits in: pre-approval filing and
 * review, or post-approval processing after a grant decision.
 *
 * Status ({@see Status}) describes where the file is within its lane;
 * phase describes which lane the list tabs filter on.
 */
class Phase
{
    public const PRE_APPROVAL = 'pre_approval';

    public const POST_APPROVAL = 'post_approval';

    public const ALL = [
        self::PRE_APPROVAL,
        self::POST_APPROVAL,
    ];

    private const LABELS = [
        self::PRE_APPROVAL => 'Pre-Approval',
        self::POST_APPROVAL => 'Post-Approval',
    ];

    public static function isValid(string $phase): bool
    {
        return in_array($phase, self::ALL, true);
    }

    public static function label(string $phase): string
    {
        return self::LABELS[$phase] ?? $phase;
    }
}
