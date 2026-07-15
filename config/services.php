<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI', env('APP_URL').'/auth/social/google/callback'),
        // Email/calendar sync. Off until the Gmail + Calendar APIs are enabled
        // in Google Cloud and the app is verified for these restricted scopes.
        'sync' => (bool) env('GOOGLE_SYNC_ENABLED', false),
        'scope_email' => 'https://www.googleapis.com/auth/gmail.readonly',
        'scope_calendar' => 'https://www.googleapis.com/auth/calendar.readonly',
    ],

    'microsoft' => [
        'client_id' => env('MICROSOFT_CLIENT_ID'),
        'client_secret' => env('MICROSOFT_CLIENT_SECRET'),
        'redirect' => env('MICROSOFT_REDIRECT_URI', env('APP_URL').'/auth/social/microsoft/callback'),
        'tenant' => env('MICROSOFT_TENANT', 'common'),
        // We fetch the profile photo ourselves (SocialAuthController) via the
        // unsized Graph /me/photo/$value endpoint, which works for both work and
        // personal accounts — the driver's sized /photos/{size} endpoint 404s on
        // many accounts. So the driver's own avatar fetch stays off.
        'include_avatar' => false,
        // Email/calendar sync via Microsoft Graph. Off until Mail.Read +
        // Calendars.Read delegated permissions are added to the Entra app.
        'sync' => (bool) env('MICROSOFT_SYNC_ENABLED', false),
        'scope_email' => 'Mail.Read',
        'scope_calendar' => 'Calendars.Read',
        'scope_onedrive' => 'Files.Read',
        'scope_sharepoint' => 'Sites.Read.All',
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
