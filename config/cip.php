<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Dependant age bracket
    |--------------------------------------------------------------------------
    |
    | The age at which a dependant stops owing the younger checklist and starts
    | owing the older one. It is a rule of the programme being filed under, not
    | of this portal, so it is the firm's to set rather than ours to hard-code.
    |
    | The age is measured against the application's creation date, never against
    | today. A dependant who has a birthday while the file is open would
    | otherwise change bracket underneath everyone: a checklist a reviewer had
    | worked through and signed off would grow a line nobody had asked for, and
    | the application would read as incomplete for a reason no one could see.
    |
    | The module's on/off switch is not here — it is services.cip.enabled, with
    | the rest of the feature flags.
    |
    */

    'dependent_age_cutoff' => (int) env('CIP_DEPENDENT_AGE_CUTOFF', 16),

];
