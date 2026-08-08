<?php

namespace App\Observers;

use App\Support\Realtime\Live;

/**
 * Calendars and their events.
 *
 * Named CalendarLiveObserver rather than CalendarObserver so it cannot be
 * mistaken for something that owns calendar behaviour — it only signals.
 */
class CalendarLiveObserver extends LiveResourceObserver
{
    protected function resource(): string
    {
        return Live::CALENDAR;
    }
}
