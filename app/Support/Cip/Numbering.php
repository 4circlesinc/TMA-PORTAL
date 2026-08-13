<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Internal application numbers: [Provider Code][YY]-[Sequence], minted the
 * moment an application is created and never reused, never changed.
 *
 * The sequence advances under a row lock on cip_counters — one row per
 * (provider, year) — so two simultaneous creates cannot mint GAL26-00003
 * twice. max()+1 over cip_applications would race exactly there. Call only
 * inside the transaction that inserts the application, so a failed insert
 * rolls the counter back with it and the sequence stays gapless.
 */
class Numbering
{
    public static function next(CipProvider $provider, ?CarbonInterface $when = null): string
    {
        // Outside a transaction the row lock releases the moment the SELECT
        // returns, and two creates can mint the same number. Refuse loudly.
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Numbering::next() must run inside the transaction that inserts the application.');
        }

        $year = (int) ($when ?? now())->format('y');

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

        $sequence = $counter->last_sequence + 1;

        DB::table('cip_counters')
            ->where('id', $counter->id)
            ->update(['last_sequence' => $sequence, 'updated_at' => now()]);

        return sprintf('%s%02d-%05d', strtoupper($provider->code), $year, $sequence);
    }
}
