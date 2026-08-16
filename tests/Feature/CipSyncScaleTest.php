<?php

namespace Tests\Feature;

use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Reading a page of applications must cost the same whatever is on it.
 *
 * The sync endpoint hands back fifty whole applications — every person, every
 * checklist — and it is the endpoint a desktop calls to catch up after a week
 * away. Three separate per-row queries hid in it, each invisible on the single
 * application a feature test reads and each multiplied by fifty here: the
 * family size counted twice per application through a COUNT, and every
 * person's outstanding documents fetched again from a relation the same
 * request had already loaded in full.
 *
 * Twenty applications cost sixty-five queries before this test existed and
 * five after it.
 */
class CipSyncScaleTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    /** Applications with a family on each, because the cost is per person. */
    private function plant(User $staff, int $count): void
    {
        $company = Company::firstOrCreate(['uid' => 'galaxy'], ['name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::firstOrCreate(['code' => 'GAL'], ['name' => 'Galaxy', 'company_id' => $company->id]);

        foreach (range(1, $count) as $i) {
            $application = Applications::create($provider, $staff);

            $client = Client::create([
                'uid' => 'client-'.$i.'-'.Str::random(5), 'name' => 'Client '.$i,
                'created_by' => $staff->id, 'data' => [],
            ]);
            $application->forceFill(['client_id' => $client->id])->save();

            CipPerson::create([
                'application_id' => $application->id, 'role' => CipPerson::ROLE_MAIN_APPLICANT,
                'first_name' => 'Main', 'last_name' => 'Applicant '.$i,
            ]);
            CipPerson::create([
                'application_id' => $application->id, 'role' => CipPerson::ROLE_SPONSOR,
                'first_name' => 'Spon', 'last_name' => 'Sor '.$i,
            ]);
        }
    }

    private function cost(User $staff): int
    {
        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->actingAs($staff)->getJson('/portal/cip/applications/sync')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    }

    public function test_a_sync_page_does_not_cost_a_query_per_application(): void
    {
        $staff = $this->admin();

        $this->plant($staff, 2);
        $few = $this->cost($staff);

        $this->plant($staff, 18);
        $many = $this->cost($staff);

        $this->assertLessThanOrEqual(
            $few + 2,
            $many,
            "Two applications cost {$few} queries and twenty cost {$many}: something in the record "
            .'is being fetched a row — or a person — at a time.',
        );
    }
}
