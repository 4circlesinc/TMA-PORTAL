<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Internal application numbers, minted the moment a row is created and
 * never reused, never changed.
 *
 * Family files: [Provider Code][YY]-[Sequence], GAL26-00001.
 * Add-On files: [Provider Code]-AO-[YY]-[Sequence], GAL-AO-26-00001.
 *
 * Each lane has its own sequence under a row lock on cip_counters, one row
 * per (provider, year, lane), so two simultaneous creates cannot mint the
 * same number and an Add-On does not consume a family slot. Call only
 * inside the transaction that inserts the application, so a failed insert
 * rolls the counter back with it and the sequence stays gapless.
 */
class Numbering
{
    public const LANE_APPLICATION = 'application';

    public const LANE_ADD_ON = 'add_on';

    public static function next(
        CipProvider $provider,
        ?CarbonInterface $when = null,
        string $lane = self::LANE_APPLICATION,
    ): string {
        self::assertTransaction();
        $lane = self::assertLane($lane);

        $year = (int) ($when ?? now())->format('y');
        $counter = self::lockedCounter($provider, $year, $lane);
        $sequence = $counter->last_sequence + 1;

        DB::table('cip_counters')
            ->where('id', $counter->id)
            ->update(['last_sequence' => $sequence, 'updated_at' => now()]);

        return self::format($provider->code, $year, $sequence, $lane);
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

        $counter = self::lockedCounter($provider, $parsed['year'], $parsed['lane']);
        if ($parsed['sequence'] > $counter->last_sequence) {
            DB::table('cip_counters')
                ->where('id', $counter->id)
                ->update(['last_sequence' => $parsed['sequence'], 'updated_at' => now()]);
        }
    }

    /** True when this string is this provider's family or Add-On number. */
    public static function matches(CipProvider $provider, string $number): bool
    {
        return self::parse($provider, $number) !== null;
    }

    /**
     * @return array{year: int, sequence: int, lane: string}|null
     */
    private static function parse(CipProvider $provider, string $number): ?array
    {
        $code = preg_quote(strtoupper($provider->code), '/');
        $value = strtoupper(trim($number));

        if (preg_match('/^'.$code.'-AO-(\d{2})-(\d{5})$/', $value, $match)) {
            return [
                'year' => (int) $match[1],
                'sequence' => (int) $match[2],
                'lane' => self::LANE_ADD_ON,
            ];
        }

        if (preg_match('/^'.$code.'(\d{2})-(\d{5})$/', $value, $match)) {
            return [
                'year' => (int) $match[1],
                'sequence' => (int) $match[2],
                'lane' => self::LANE_APPLICATION,
            ];
        }

        return null;
    }

    private static function format(string $code, int $year, int $sequence, string $lane): string
    {
        $code = strtoupper($code);

        if ($lane === self::LANE_ADD_ON) {
            return sprintf('%s-AO-%02d-%05d', $code, $year, $sequence);
        }

        return sprintf('%s%02d-%05d', $code, $year, $sequence);
    }

    private static function assertLane(string $lane): string
    {
        if (! in_array($lane, [self::LANE_APPLICATION, self::LANE_ADD_ON], true)) {
            throw new \InvalidArgumentException('Unknown numbering lane.');
        }

        return $lane;
    }

    private static function assertTransaction(): void
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Numbering must run inside the transaction that inserts the application.');
        }
    }

    private static function lockedCounter(CipProvider $provider, int $year, string $lane): object
    {
        $counter = DB::table('cip_counters')
            ->where('provider_id', $provider->id)
            ->where('year', $year)
            ->where('lane', $lane)
            ->lockForUpdate()
            ->first();

        if ($counter === null) {
            // First number of the year in this lane. insertOrIgnore + re-lock
            // rather than insert: two firsts can race, and the unique
            // (provider, year, lane) index turns the loser's insert into a
            // no-op re-read.
            DB::table('cip_counters')->insertOrIgnore([
                'provider_id' => $provider->id,
                'year' => $year,
                'lane' => $lane,
                'last_sequence' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $counter = DB::table('cip_counters')
                ->where('provider_id', $provider->id)
                ->where('year', $year)
                ->where('lane', $lane)
                ->lockForUpdate()
                ->first();
        }

        return $counter;
    }
}
