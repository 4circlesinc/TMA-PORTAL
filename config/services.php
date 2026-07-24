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
        // gmail.modify covers reading, sending, and moving/labelling. It is a
        // RESTRICTED scope: production use by anyone outside the test-user
        // list requires Google's CASA security assessment. gmail.readonly was
        // equally restricted, so this widens what we can do without changing
        // the tier of review the app needs.
        //
        // directory.readonly + contacts.other.readonly let compose suggestions
        // and the inbox show real Google/Workspace profile photos for people
        // in the firm or people you've emailed — without them every face is
        // initials. Existing mail connections must reconnect once to pick
        // these up.
        'scope_email' => 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/directory.readonly https://www.googleapis.com/auth/contacts.other.readonly',
        // Two-way calendar sync. `calendar.events` is read+write on events and
        // is a SENSITIVE scope: production use by anyone outside the test-user
        // list needs Google's app-verification (not the heavier CASA the Gmail
        // restricted scope requires). Existing connections granted only
        // calendar.readonly must reconnect once to gain write — the account's
        // canWriteCalendar() detects that and the UI prompts for it.
        'scope_calendar' => 'https://www.googleapis.com/auth/calendar.events',
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
        // Email/calendar sync via Microsoft Graph. Off until the delegated
        // permissions below are added to the Entra app.
        'sync' => (bool) env('MICROSOFT_SYNC_ENABLED', false),
        // ReadWrite covers listing, moving, flagging and drafting; Send is a
        // separate permission in Graph, so sending needs both.
        // User.ReadBasic.All lets the mailbox show colleagues' real profile
        // photos: Graph only returns /users/{id}/photo for people in the same
        // tenant, and only with a directory read permission. Without it every
        // sender simply falls back to initials.
        'scope_email' => 'Mail.ReadWrite Mail.Send User.ReadBasic.All',
        // ReadWrite covers listing, creating, updating and deleting events —
        // the two-way sync needs it. Existing Calendars.Read connections must
        // reconnect once; canWriteCalendar() detects the narrower grant.
        'scope_calendar' => 'Calendars.ReadWrite',
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
