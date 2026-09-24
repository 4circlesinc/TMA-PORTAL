<?php

namespace App\Support\Privacy;

use App\Models\User;

/**
 * The published privacy policy the portal asks people to accept.
 *
 * VERSION must move in step with the "Last updated" date on
 * public/privacy-policy/index.html. Acceptance is a record that they were
 * shown that text. It is not the lawful basis for matter files — those are
 * kept to perform the work and to meet professional record-keeping duties.
 */
final class PrivacyPolicy
{
    public const VERSION = '2026-09-24';

    public static function recordAcceptance(User $user): void
    {
        $user->forceFill([
            'privacy_policy_accepted_at' => now(),
            'privacy_policy_version' => self::VERSION,
        ])->save();
    }
}
