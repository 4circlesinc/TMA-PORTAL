<?php

namespace App\Support\Presence;

use App\Models\User;
use App\Support\UserTime;
use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * How the portal says when somebody was last around.
 *
 * One formatter for every presence display - the Employees board, the People
 * directory, the account table, the messaging header - so "last seen" reads
 * the same wherever it appears. Before this, three call sites each reached for
 * Carbon's diffForHumans() and produced three different sentences ("2 hours
 * ago", "Last seen 2h ago", a raw date) for one fact.
 *
 * The wording is deliberately closer to a person than to a clock:
 *
 *   Last seen just now
 *   Last seen 5 minutes ago
 *   Last seen 1 hour ago
 *   Last seen yesterday at 8:15 PM
 *   Last seen Friday at 8:15 PM
 *   Last seen August 2, 2026 at 8:15 PM
 *
 * Everything is rendered on the *reader's* wall clock (App\Support\UserTime),
 * because "yesterday at 8:15 PM" is only true in one time zone. Anything fanned
 * out to several people at once must not be formatted here - see UserTime.
 */
final class LastSeen
{
    /** Beyond this, a weekday name stops being a useful anchor. */
    private const RECENT_DAYS = 7;

    /**
     * The label with its "Last seen " prefix, for use as a standalone line.
     *
     * A null instant is "recently" rather than "never" or a blank: the caller
     * that has no timestamp is usually one whose subject hides their detail,
     * and the absence of data should not read as a distinct state.
     */
    public static function label(DateTimeInterface|string|null $at, ?User $viewer = null): string
    {
        return 'Last seen '.self::relative($at, $viewer);
    }

    /** The same phrasing without the prefix, for callers that supply their own. */
    public static function relative(DateTimeInterface|string|null $at, ?User $viewer = null): string
    {
        $when = self::normalize($at, $viewer);

        if ($when === null) {
            return 'recently';
        }

        $now = Carbon::now($when->getTimezone());

        // A clock skewed a little into the future is not a reason to print
        // nonsense; treat anything not yet past as happening now.
        if ($when->greaterThanOrEqualTo($now)) {
            return 'just now';
        }

        $seconds = (int) $when->diffInSeconds($now, absolute: true);

        if ($seconds < 60) {
            return 'just now';
        }

        if ($seconds < 3600) {
            return self::plural(intdiv($seconds, 60), 'minute').' ago';
        }

        // Hours only while it is still the same calendar day. At 00:30, an
        // event from 22:00 is "yesterday at 10:00 PM", not "2 hours ago".
        if ($when->isSameDay($now)) {
            return self::plural(intdiv($seconds, 3600), 'hour').' ago';
        }

        $time = $when->format('g:i A');

        if ($when->isYesterday()) {
            return 'yesterday at '.$time;
        }

        if ($when->greaterThan($now->copy()->subDays(self::RECENT_DAYS))) {
            return $when->format('l').' at '.$time;
        }

        return $when->format('F j, Y').' at '.$time;
    }

    /**
     * A short form for dense tables: "5 min ago", "Yesterday", "Aug 2, 2026".
     *
     * Same instants, same rules, fewer characters - a column that has to fit
     * beside six others cannot carry a full sentence.
     */
    public static function short(DateTimeInterface|string|null $at, ?User $viewer = null): ?string
    {
        $when = self::normalize($at, $viewer);

        if ($when === null) {
            return null;
        }

        $now = Carbon::now($when->getTimezone());
        $seconds = (int) $when->diffInSeconds($now, absolute: true);

        if ($when->greaterThanOrEqualTo($now) || $seconds < 60) {
            return 'Just now';
        }

        if ($seconds < 3600) {
            return intdiv($seconds, 60).' min ago';
        }

        if ($when->isSameDay($now)) {
            return self::plural(intdiv($seconds, 3600), 'hour').' ago';
        }

        if ($when->isYesterday()) {
            return 'Yesterday';
        }

        if ($when->greaterThan($now->copy()->subDays(self::RECENT_DAYS))) {
            return $when->format('l');
        }

        return $when->format('M j, Y');
    }

    /** The same instant on the reader's wall clock, or null if there isn't one. */
    private static function normalize(DateTimeInterface|string|null $at, ?User $viewer): ?Carbon
    {
        if ($at === null || $at === '') {
            return null;
        }

        try {
            $carbon = $at instanceof DateTimeInterface
                ? Carbon::instance($at)
                : Carbon::parse($at);
        } catch (\Throwable) {
            return null;
        }

        return $carbon->setTimezone(UserTime::zone($viewer));
    }

    private static function plural(int $n, string $unit): string
    {
        return $n.' '.$unit.($n === 1 ? '' : 's');
    }
}
