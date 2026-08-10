<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Dashboard metrics
    |--------------------------------------------------------------------------
    |
    | The KPI cards on the portal home compare a trailing window against the
    | window immediately before it. `lookback_days` bounds how far back the
    | unanswered-thread scan reaches, and is what keeps the metric queries from
    | walking the whole message history on a mature account.
    |
    */

    'metrics' => [
        'window_days' => (int) env('PORTAL_METRICS_WINDOW_DAYS', 30),
        'lookback_days' => (int) env('PORTAL_METRICS_LOOKBACK_DAYS', 90),
    ],

    /*
    |--------------------------------------------------------------------------
    | Storage allowance
    |--------------------------------------------------------------------------
    |
    | What Settings > Storage > Usage measures the account against. Nothing on
    | this server can observe what the plan allows, so it is stated here rather
    | than guessed: storage is sold per licence (1 TB per staff account), and an
    | account on a flat allowance sets PORTAL_STORAGE_LIMIT_BYTES to override
    | the per-licence maths entirely. Set neither and the page reports what is
    | stored without claiming to know the ceiling.
    |
    */

    'storage' => [
        'limit_bytes' => (int) env('PORTAL_STORAGE_LIMIT_BYTES', 0),
        'per_licence_bytes' => (int) env('PORTAL_STORAGE_PER_LICENCE_BYTES', 1024 ** 4),
    ],

    /*
    |--------------------------------------------------------------------------
    | The firm's own account
    |--------------------------------------------------------------------------
    |
    | Who owns a file that belongs to the firm rather than to a person: the
    | SharePoint document libraries, the folders the portal provisions, and
    | anything else created with no obvious human owner.
    |
    | Before this, "the firm" resolved to the lowest-numbered administrator —
    | which was whoever was seeded first. Thirty thousand citizenship documents
    | ended up filed under one partner's name, and the Owner column read as a
    | wall of that one person for files nobody thought of as theirs.
    |
    | Falls back to the oldest administrator if this account does not exist, so
    | a fresh install with no service account still works.
    |
    */

    'system_account_email' => env('PORTAL_SYSTEM_ACCOUNT_EMAIL', 'portal@tmantoinelaw.com'),

];
