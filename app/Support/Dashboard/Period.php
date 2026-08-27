<?php

namespace App\Support\Dashboard;

use App\Models\User;
use App\Support\UserTime;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * The stretch of time the KPI row measures: the picker's Today / This week /
 * This month / This year, or the rolling window from config when nobody asked.
 *
 * Calendar periods run from their boundary to *now*, on the reader's wall
 * clock (Settings → Time and language), so "today" ends at their midnight,
 * not the server's. The comparison is the same stretch of the previous
 * period, this Sunday-to-Wednesday against last Sunday-to-Wednesday, so a
 * week that is three days old is not read against seven days of the last
 * one and called a collapse.
 *
 * Every instant leaves here in UTC. Timestamps are stored in UTC and a query
 * binding is formatted in whatever zone the Carbon carries, so a local-zone
 * boundary handed straight to the builder would be read as UTC and land
 * hours off.
 */
final class Period
{
    public const TODAY = 'today';

    public const WEEK = 'week';

    public const MONTH = 'month';

    public const YEAR = 'year';

    public const ROLLING = 'rolling';

    private const CALENDAR = [self::TODAY, self::WEEK, self::MONTH, self::YEAR];

    /** The portal's calendars start the week on Sunday; so does this one. */
    private const WEEK_STARTS = CarbonInterface::SUNDAY;

    private function __construct(
        public readonly string $key,
        public readonly CarbonImmutable $now,
        public readonly CarbonImmutable $windowStart,
        public readonly CarbonImmutable $priorStart,
        public readonly CarbonImmutable $priorEnd,
        public readonly CarbonImmutable $lookbackStart,
        /** Days the window spans; the config figure for rolling, elapsed days otherwise. */
        public readonly int $days,
    ) {}

    /** The picker's key, or null for anything that is not one. */
    public static function parse(?string $raw): ?string
    {
        $raw = strtolower(trim((string) $raw));

        return in_array($raw, self::CALENDAR, true) ? $raw : null;
    }

    public static function for(?string $key, ?User $reader, ?CarbonImmutable $now = null): self
    {
        $now = ($now ?? CarbonImmutable::now())->utc();

        if ($key === null || ! in_array($key, self::CALENDAR, true)) {
            return self::rolling($now);
        }

        $local = $now->setTimezone(UserTime::zone($reader));

        [$windowStart, $priorStart, $priorEnd] = match ($key) {
            self::TODAY => [$s = $local->startOfDay(), $s->subDay(), $local->subDay()],
            self::WEEK => [$s = $local->startOfWeek(self::WEEK_STARTS), $s->subWeek(), $local->subWeek()],
            self::MONTH => [$s = $local->startOfMonth(), $s->subMonthNoOverflow(), $local->subMonthNoOverflow()],
            self::YEAR => [$s = $local->startOfYear(), $s->subYear(), $local->subYear()],
        };

        $windowStart = $windowStart->utc();
        $priorStart = $priorStart->utc();

        return new self(
            key: $key,
            now: $now,
            windowStart: $windowStart,
            priorStart: $priorStart,
            priorEnd: $priorEnd->utc(),
            lookbackStart: $priorStart->min(self::configLookback($now)),
            days: max(1, (int) ceil($windowStart->diffInDays($now, true))),
        );
    }

    /** The trailing window from config, against the window before it. */
    private static function rolling(CarbonImmutable $now): self
    {
        $windowDays = max(1, (int) config('portal.metrics.window_days', 30));
        $windowStart = $now->subDays($windowDays);
        $priorStart = $now->subDays($windowDays * 2);

        return new self(
            key: self::ROLLING,
            now: $now,
            windowStart: $windowStart,
            priorStart: $priorStart,
            priorEnd: $windowStart,
            lookbackStart: $priorStart->min(self::configLookback($now)),
            days: $windowDays,
        );
    }

    /**
     * How far back the channel readers scan. The response clock starts on a
     * client's *first* unanswered message, so the readers need some runway
     * before the comparison window or an old question read as a fresh one.
     */
    private static function configLookback(CarbonImmutable $now): CarbonImmutable
    {
        return $now->subDays(max(1, (int) config('portal.metrics.lookback_days', 90)));
    }

    /** How the window reads in a sentence: "filed this week", "filed in the last 30 days". */
    public function phrase(): string
    {
        return match ($this->key) {
            self::TODAY => 'today',
            self::WEEK => 'this week',
            self::MONTH => 'this month',
            self::YEAR => 'this year',
            default => 'in the last '.$this->days.' days',
        };
    }
}
