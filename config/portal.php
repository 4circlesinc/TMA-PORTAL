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
    | Signature quota
    |--------------------------------------------------------------------------
    |
    | How many signature requests the account may send. There is no billing
    | system yet, so the allowance is configuration rather than a plan record —
    | set the limit to 0 for unlimited. `plan_label` is what the KPI card shows
    | beside the remaining count.
    |
    */

    'signatures' => [
        'limit' => (int) env('PORTAL_SIGNATURE_LIMIT', 5),
        'plan_label' => env('PORTAL_PLAN_LABEL', 'Trial'),
    ],

];
