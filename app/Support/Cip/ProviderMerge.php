<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipProvider;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * One firm, one provider row.
 *
 * The register grew a second code whenever the first was taken: Respect
 * Services beside Respect Services 3, iGraphix beside iGaphix. Applications
 * stay on the firm that remains. Their numbers are not rewritten.
 */
class ProviderMerge
{
    public static function run(): void
    {
        foreach (self::groups() as $group) {
            self::merge($group);
        }
    }

    /**
     * @return Collection<int, Collection<int, CipProvider>>
     */
    public static function groups(): Collection
    {
        $providers = CipProvider::query()->orderBy('id')->get();
        $buckets = [];

        foreach ($providers as $provider) {
            $key = self::key($provider->name);
            $matched = null;

            foreach ($buckets as $existing => $_) {
                if ($existing === $key || self::sameFirm($existing, $key)) {
                    $matched = $existing;
                    break;
                }
            }

            $buckets[$matched ?? $key][] = $provider;
        }

        return collect($buckets)
            ->map(fn (array $rows) => collect($rows))
            ->filter(fn (Collection $group) => $group->count() > 1)
            ->values();
    }

    /**
     * @param  Collection<int, CipProvider>  $group
     */
    public static function merge(Collection $group): CipProvider
    {
        $survivor = self::survivor($group);

        DB::transaction(function () use ($group, $survivor) {
            foreach ($group as $other) {
                if ($other->id === $survivor->id) {
                    continue;
                }

                CipApplication::withTrashed()
                    ->where('provider_id', $other->id)
                    ->update(['provider_id' => $survivor->id]);

                self::moveCounters($other, $survivor);

                if ($survivor->company_id === null && $other->company_id !== null) {
                    $survivor->company_id = $other->company_id;
                }

                if ($survivor->folder_id === null && $other->folder_id !== null) {
                    $survivor->folder_id = $other->folder_id;
                }

                $other->delete();
            }

            $code = self::codeFor($survivor, $group);
            if ($code !== $survivor->code) {
                $blocking = CipProvider::withTrashed()
                    ->where('code', $code)
                    ->whereKeyNot($survivor->id)
                    ->first();

                if ($blocking) {
                    $blocking->forceFill([
                        'code' => self::retiredCode($blocking),
                    ])->save();
                }

                $survivor->code = $code;
            }

            $survivor->save();
        });

        return $survivor->fresh();
    }

    public static function key(string $name): string
    {
        $key = strtoupper(trim((string) preg_replace('/\s+/', ' ', $name)));
        $key = (string) preg_replace('/\s+\d+$/', '', $key);

        return $key;
    }

    public static function sameFirm(string $left, string $right): bool
    {
        if ($left === $right) {
            return true;
        }

        $shorter = min(strlen($left), strlen($right));

        return $shorter >= 6 && levenshtein($left, $right) <= 1;
    }

    /**
     * @param  Collection<int, CipProvider>  $group
     */
    private static function survivor(Collection $group): CipProvider
    {
        $preferred = self::preferredCode($group);
        if ($preferred) {
            $match = $group->first(fn (CipProvider $provider) => $provider->code === $preferred);
            if ($match) {
                return $match;
            }
        }

        return $group->sort(function (CipProvider $left, CipProvider $right) {
            $rank = function (CipProvider $provider) {
                return [
                    $provider->company_id === null ? 1 : 0,
                    -1 * $provider->applications()->count(),
                    strlen($provider->code),
                    $provider->id,
                ];
            };

            return $rank($left) <=> $rank($right);
        })->values()->first();
    }

    /**
     * @param  Collection<int, CipProvider>  $group
     */
    private static function preferredCode(Collection $group): ?string
    {
        $key = self::key($group->first()->name);

        if (self::sameFirm($key, 'RESPECT SERVICES')) {
            return 'RES';
        }

        return null;
    }

    /**
     * @param  Collection<int, CipProvider>  $group
     */
    private static function codeFor(CipProvider $survivor, Collection $group): string
    {
        return self::preferredCode($group) ?? $survivor->code;
    }

    private static function retiredCode(CipProvider $provider): string
    {
        $code = 'OLD'.$provider->id;

        return substr($code, 0, 8);
    }

    private static function moveCounters(CipProvider $from, CipProvider $to): void
    {
        $rows = DB::table('cip_counters')->where('provider_id', $from->id)->get();

        foreach ($rows as $row) {
            $kept = DB::table('cip_counters')
                ->where('provider_id', $to->id)
                ->where('year', $row->year)
                ->first();

            if ($kept) {
                DB::table('cip_counters')->where('id', $kept->id)->update([
                    'last_sequence' => max((int) $kept->last_sequence, (int) $row->last_sequence),
                    'updated_at' => now(),
                ]);
                DB::table('cip_counters')->where('id', $row->id)->delete();

                continue;
            }

            DB::table('cip_counters')->where('id', $row->id)->update([
                'provider_id' => $to->id,
                'updated_at' => now(),
            ]);
        }
    }
}
