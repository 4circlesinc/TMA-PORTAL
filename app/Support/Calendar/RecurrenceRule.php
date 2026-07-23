<?php

namespace App\Support\Calendar;

use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * Translates between the recurrence the UI talks about ("every 2 weeks on Mon
 * and Wed, 10 times") and the RFC 5545 RRULE string stored on the event.
 *
 * RRULE is the storage format rather than a set of columns because it is what
 * ICS export writes, what ICS import reads, and what Google and Microsoft both
 * speak — keeping anything else as the source of truth would mean translating
 * at every boundary.
 */
class RecurrenceRule
{
    public const FREQ_DAILY = 'DAILY';

    public const FREQ_WEEKLY = 'WEEKLY';

    public const FREQ_MONTHLY = 'MONTHLY';

    public const FREQ_YEARLY = 'YEARLY';

    public const FREQS = [self::FREQ_DAILY, self::FREQ_WEEKLY, self::FREQ_MONTHLY, self::FREQ_YEARLY];

    /** RFC 5545 weekday codes, Monday first to match the portal's week. */
    public const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

    public const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR'];

    /**
     * Build an RRULE from the form's shape.
     *
     * @param  array<string, mixed>  $spec
     */
    public static function build(array $spec): ?string
    {
        $freq = strtoupper((string) ($spec['freq'] ?? ''));

        if ($freq === '' || $freq === 'NONE') {
            return null;
        }

        if (! in_array($freq, self::FREQS, true)) {
            throw ValidationException::withMessages(['recurrence' => 'That repeat option is not supported.']);
        }

        $parts = ['FREQ='.$freq];

        $interval = (int) ($spec['interval'] ?? 1);
        if ($interval > 1) {
            if ($interval > 366) {
                throw ValidationException::withMessages(['recurrence' => 'That interval is too large.']);
            }
            $parts[] = 'INTERVAL='.$interval;
        }

        $days = array_values(array_filter(
            array_map('strtoupper', (array) ($spec['byDay'] ?? [])),
            fn ($d) => in_array($d, self::DAYS, true),
        ));

        if ($days) {
            $parts[] = 'BYDAY='.implode(',', $days);
        }

        if (! empty($spec['byMonthDay'])) {
            $mdays = array_values(array_filter(
                array_map('intval', (array) $spec['byMonthDay']),
                fn ($d) => $d >= -31 && $d <= 31 && $d !== 0,
            ));
            if ($mdays) {
                $parts[] = 'BYMONTHDAY='.implode(',', $mdays);
            }
        }

        /*
         * COUNT and UNTIL are mutually exclusive in RFC 5545. The UI offers
         * "after N times" / "on a date" / "never" as one choice, so only one
         * can arrive — but a malformed request must not produce a rule that
         * every other calendar client rejects.
         */
        $count = isset($spec['count']) ? (int) $spec['count'] : 0;
        $until = $spec['until'] ?? null;

        if ($count > 0 && $until) {
            throw ValidationException::withMessages([
                'recurrence' => 'Choose either a number of occurrences or an end date, not both.',
            ]);
        }

        if ($count > 0) {
            if ($count > 1000) {
                throw ValidationException::withMessages(['recurrence' => 'That is too many occurrences.']);
            }
            $parts[] = 'COUNT='.$count;
        } elseif ($until) {
            // UNTIL is UTC with a trailing Z; a local time here is a common
            // source of off-by-one-day recurrence bugs.
            $parts[] = 'UNTIL='.CarbonImmutable::parse($until)->utc()->format('Ymd\THis\Z');
        }

        return implode(';', $parts);
    }

    /**
     * The inverse: an RRULE back into the shape the form renders. Unknown or
     * unsupported parts are dropped rather than guessed at.
     *
     * @return array<string, mixed>
     */
    public static function parse(?string $rule): array
    {
        if (! $rule) {
            return ['freq' => 'NONE'];
        }

        $out = ['freq' => 'NONE', 'interval' => 1, 'byDay' => [], 'count' => null, 'until' => null];

        foreach (explode(';', $rule) as $chunk) {
            $pair = explode('=', $chunk, 2);
            if (count($pair) !== 2) {
                continue;
            }

            [$key, $value] = [strtoupper(trim($pair[0])), trim($pair[1])];

            match ($key) {
                'FREQ' => $out['freq'] = strtoupper($value),
                'INTERVAL' => $out['interval'] = max(1, (int) $value),
                'BYDAY' => $out['byDay'] = array_values(array_filter(
                    array_map('strtoupper', explode(',', $value)),
                    fn ($d) => in_array($d, self::DAYS, true),
                )),
                'BYMONTHDAY' => $out['byMonthDay'] = array_map('intval', explode(',', $value)),
                'COUNT' => $out['count'] = (int) $value,
                'UNTIL' => $out['until'] = self::parseUntil($value),
                default => null,
            };
        }

        return $out;
    }

    /** Plain-language summary, for the event panel and the ICS import preview. */
    public static function describe(?string $rule): string
    {
        if (! $rule) {
            return '';
        }

        $spec = self::parse($rule);
        $interval = $spec['interval'] ?? 1;

        $every = match ($spec['freq']) {
            self::FREQ_DAILY => $interval > 1 ? "Every {$interval} days" : 'Daily',
            self::FREQ_WEEKLY => $interval > 1 ? "Every {$interval} weeks" : 'Weekly',
            self::FREQ_MONTHLY => $interval > 1 ? "Every {$interval} months" : 'Monthly',
            self::FREQ_YEARLY => $interval > 1 ? "Every {$interval} years" : 'Yearly',
            default => 'Repeats',
        };

        $days = $spec['byDay'] ?? [];
        if ($days) {
            // "Weekdays" reads better than the five codes spelled out.
            $isWeekdays = count($days) === 5 && ! array_diff($days, self::WEEKDAYS);
            $every .= $isWeekdays
                ? ' on weekdays'
                : ' on '.implode(', ', array_map(fn ($d) => self::dayName($d), $days));
        }

        if (! empty($spec['count'])) {
            $every .= ', '.$spec['count'].' times';
        } elseif (! empty($spec['until'])) {
            $every .= ', until '.CarbonImmutable::parse($spec['until'])->format('j M Y');
        }

        return $every;
    }

    private static function dayName(string $code): string
    {
        return [
            'MO' => 'Mon', 'TU' => 'Tue', 'WE' => 'Wed', 'TH' => 'Thu',
            'FR' => 'Fri', 'SA' => 'Sat', 'SU' => 'Sun',
        ][$code] ?? $code;
    }

    /** UNTIL may be a date or a date-time, with or without the Z. */
    private static function parseUntil(string $value): ?string
    {
        try {
            return CarbonImmutable::parse($value)->utc()->toIso8601String();
        } catch (\Throwable) {
            return null;
        }
    }
}
