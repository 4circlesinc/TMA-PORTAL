<?php

namespace App\Support\Privacy;

use App\Models\ConnectedAccount;
use App\Models\PrivacyRequest;
use App\Models\User;

/**
 * Stop optional processing while a restriction is in place (GDPR Art. 18).
 *
 * Connected-account sync is the optional processing. Matter work the person
 * asked the firm to do continues. Turning sync back on in settings has no
 * effect until the restriction is lifted — ConnectedAccount refuses the flags.
 */
final class ProcessingRestriction
{
    public static function restrict(User $user): void
    {
        $preferences = $user->preferences ?? [];
        $preferences['notifyAlwaysEmail'] = false;

        $user->forceFill([
            'processing_restricted_at' => now(),
            'preferences' => $preferences,
        ])->save();

        ConnectedAccount::query()->where('user_id', $user->id)->update([
            'sync_email' => false,
            'sync_calendar' => false,
            'sync_onedrive' => false,
            'sync_sharepoint' => false,
        ]);

        PrivacyRequest::query()->create([
            'user_id' => $user->id,
            'type' => PrivacyRequest::TYPE_RESTRICTION,
            'status' => PrivacyRequest::STATUS_COMPLETED,
            'detail' => [
                'policyVersion' => PrivacyPolicy::VERSION,
                'stopped' => 'Optional Google and Microsoft sync, and the extra email copy of notifications.',
                'continues' => 'The portal account and any matter the firm was engaged to handle.',
            ],
        ]);
    }

    public static function lift(User $user): void
    {
        $user->forceFill(['processing_restricted_at' => null])->save();

        PrivacyRequest::query()->create([
            'user_id' => $user->id,
            'type' => PrivacyRequest::TYPE_RESTRICTION_LIFTED,
            'status' => PrivacyRequest::STATUS_COMPLETED,
            'detail' => ['policyVersion' => PrivacyPolicy::VERSION],
        ]);
    }
}
