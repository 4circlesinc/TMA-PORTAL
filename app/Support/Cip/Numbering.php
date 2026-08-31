<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Internal application numbers: [Provider Code][YY]-[Sequence], minted the
 * moment an application is created and never reused, never changed.
 *
 * The sequence advances under a row lock on cip_counters, one row per
 * (provider, year), so two simultaneous creates cannot mint GAL26-00003
 * twice. max()+1 over cip_applications would race exactly there. Call only
 * inside the transaction that inserts the application, so a failed insert
 * rolls the counter back with it and the sequence stays gapless.
 */
class Numbering
{
    public static function next(CipProvider $provider, ?CarbonInterface $when = null): string
    {
        self::assertTransaction();

        $year = (int) ($when ?? now())->format('y');
        $counter = self::lockedCounter($provider, $year);
        $sequence = $counter->last_sequence + 1;

        DB::table('cip_counters')
            ->where('id', $counter->id)
            ->update(['last_sequence' => $sequence, 'updated_at' => now()]);

        return sprintf('%s%02d-%05d', strtoupper($provider->code), $year, $sequence);
    }

    /**
     * Keep a historical internal number from being minted again.
     *
     * Adopting a number the caseload already carried without this would let
     * the next native create hand GAL26-00001 to a new filing while a row
     * already wears it.
     */
    public static function reserve(CipProvider $provider, string $number): void
    {
        self::assertTransaction();

        $parsed = self::parse($provider, $number);
        if ($parsed === null) {
            throw new \InvalidArgumentException('Not an internal number for this provider.');
        }

        $counter = self::lockedCounter($provider, $parsed['year']);
        if ($parsed['sequence'] > $counter->last_sequence) {
            DB::table('cip_counters')
                ->where('id', $counter->id)
                ->update(['last_sequence' => $parsed['sequence'], 'updated_at' => now()]);
        }
    }

    /** True when this string is [this provider's code][YY]-[Sequence]. */
    public static function matches(CipProvider $provider, string $number): bool
    {
        return self::parse($provider, $number) !== null;
    }

    /**
     * @return array{year: int, sequence: int}|null
     */
    private static function parse(CipProvider $provider, string $number): ?array
    {
        $code = strtoupper($provider->code);
        if (! preg_match('/^'.preg_quote($code, '/').'(\d{2})-(\d{5})$/', strtoupper(trim($number)), $m)) {
            return null;
        }

        return ['year' => (int) $m[1], 'sequence' => (int) $m[2]];
    }

    private static function assertTransaction(): void
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Numbering must run inside the transaction that inserts the application.');
        }
    }

    private static function lockedCounter(CipProvider $provider, int $year): object
    {
        $counter = DB::table('cip_counters')
            ->where('provider_id', $provider->id)
            ->where('year', $year)
            ->lockForUpdate()
            ->first();

        if ($counter === null) {
            // First number of the year. insertOrIgnore + re-lock rather than
            // insert: two firsts can race, and the unique (provider, year)
            // index turns the loser's insert into a no-op re-read.
            DB::table('cip_counters')->insertOrIgnore([
                'provider_id' => $provider->id,
                'year' => $year,
                'last_sequence' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $counter = DB::table('cip_counters')
                ->where('provider_id', $provider->id)
                ->where('year', $year)
                ->lockForUpdate()
                ->first();
        }

        return $counter;
    }
}
