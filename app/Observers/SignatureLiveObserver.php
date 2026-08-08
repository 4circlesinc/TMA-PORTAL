<?php

namespace App\Observers;

use App\Support\Realtime\Live;

/**
 * Signature requests and their recipients.
 *
 * Recipients matter as much as requests: a request changes state when a
 * *recipient* signs, which happens in a browser the portal never sees, so
 * without it the sender sits on "awaiting signature" long after it was signed.
 *
 * Recipients have no created_by; getAttribute returns null there and the owner
 * signal is skipped.
 */
class SignatureLiveObserver extends LiveResourceObserver
{
    protected function resource(): string
    {
        return Live::SIGNATURES;
    }

    protected function ownerColumn(): ?string
    {
        return 'created_by';
    }
}
