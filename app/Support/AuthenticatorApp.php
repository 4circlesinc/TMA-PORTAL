<?php

namespace App\Support;

/**
 * Branding for the supported authenticator apps, so the two-factor setup and
 * challenge screens name and show the app the user actually chose instead of a
 * generic "authenticator app".
 */
class AuthenticatorApp
{
    // Only Microsoft and Google Authenticator are offered. 'other' remains a
    // display-only fallback for any legacy account with no app recorded.
    public const KEYS = ['microsoft', 'google'];

    public static function meta(?string $key): array
    {
        return match ($key) {
            'microsoft' => [
                'key' => 'microsoft',
                'name' => 'Microsoft Authenticator',
                'logo' => '/images/icons/brands/MicrosoftAuthenticator.webp',
            ],
            'google' => [
                'key' => 'google',
                'name' => 'Google Authenticator',
                'logo' => '/images/icons/brands/GoogleAuthenticator.svg',
            ],
            default => [
                'key' => 'other',
                'name' => 'your authenticator app',
                'logo' => '/images/icons/phosphor/ShieldCheck.svg',
            ],
        };
    }
}
