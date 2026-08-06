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

];
