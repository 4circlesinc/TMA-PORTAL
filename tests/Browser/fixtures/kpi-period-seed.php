<?php
/*
 * Fixture for dashboard-period.mjs, on top of kpi-seed.php.
 *
 * CIP applications spread so the head's Today / This week / This month /
 * This year picker gives four different answers: one today, two more this
 * week (from Monday), two last week, one late last month, one last year.
 * Which bucket the "last week" pair lands in depends on the date the seed
 * runs, so the driver checks the row against the API's answer for the same
 * period rather than against fixed counts.
 */

use App\Models\CipProvider;
use App\Models\User;
use App\Support\Cip\Applications;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

$staff = User::where('email', 'e2e@example.com')->firstOrFail();
$provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
$now = CarbonImmutable::now();
$filed = function (CarbonImmutable $at) use ($provider, $staff) {
    Applications::create($provider, $staff)->forceFill(['created_at' => $at])->saveQuietly();
};
$filed($now->subHours(2));                    // today
$filed($now->startOfWeek(CarbonInterface::MONDAY)->addHours(9));    // Monday: this week
$filed($now->subDays(3));                     // this week (Thu -> Mon)
$filed($now->subDays(9));                     // last week
$filed($now->subDays(12));                    // last week
$filed($now->startOfMonth()->subDays(3));     // last month
$filed($now->startOfYear()->subDays(10));     // last year
echo "cip seeded\n";
