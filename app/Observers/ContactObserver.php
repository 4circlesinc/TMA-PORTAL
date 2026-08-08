<?php

namespace App\Observers;

use App\Support\Realtime\Live;

/** Address-book changes reach the People screens. */
class ContactObserver extends LiveResourceObserver
{
    protected function resource(): string
    {
        return Live::CONTACTS;
    }
}
