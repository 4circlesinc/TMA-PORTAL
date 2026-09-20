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
use Tests\TestCase;

/**
 * What opening one application costs.
 *
 * Every other CIP surface has a scale guard; the detail view had none,
 * which is how it came to ask a question per checklist row without anything
 * noticing. A file with six people carries six checklists, so a per-slot
 * query is not a fixed price, it is the family size times the requirement
 * count.
 *
 * The listing tests measure the same property the same way: ask for a small
 * family, ask for a large one, and require the number to be equal.
 */
class CipDetailScaleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function staff(): User
    {
        $user = User::create([
            'name' => 'Ada Admin',
            'email' => 'ada@example.com',
            'password' => bcrypt('password12345'),
        ]);

        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $user;
    }

    private function provider(User $owner): CipProvider
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $owner->id]);

        return CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
    }

    /** An application carrying `1 + sponsor + dependents` people. */
    private function application(User $staff, CipProvider $provider, int $dependents, bool $sponsor = true): string
    {
        $application = Applications::create($provider, $staff, [
            'investment_type' => 'real_estate',
            'sponsored' => $sponsor,
        ]);

        $client = Client::create([
            'uid' => 'chen-'.strtolower($application->internal_number),
            'name' => 'CHEN WEI',
            'email' => 'chen-'.$application->id.'@example.com',
            'created_by' => $staff->id,
            'data' => [],
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        $person = fn (string $role, string $first, ?int $ordinal = null) => CipPerson::create([
            'application_id' => $application->id,
            'role' => $role,
            'first_name' => $first,
            'last_name' => 'Wei',
            'dependent_ordinal' => $ordinal,
        ]);

        $person(CipPerson::ROLE_MAIN_APPLICANT, 'Chen');
        if ($sponsor) {
            $person(CipPerson::ROLE_SPONSOR, 'Li');
        }
        for ($i = 1; $i <= $dependents; $i++) {
            $person(CipPerson::ROLE_DEPENDENT, 'Kid'.$i, $i);
        }

        return $application->refresh()->uuid;
    }

    /**
     * Queries one open costs, with everything warm.
     *
     * The first open of an application provisions its folder tree and
     * materialises its checklist, both of which write. Those are one-off
     * costs of the first visit, not what a reader pays on every open, so the
     * count that matters is the second.
     */
    private function cost(string $uuid): int
    {
        $this->getJson('/portal/cip/applications/'.$uuid)->assertOk();

        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/portal/cip/applications/'.$uuid)->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();
        DB::flushQueryLog();

        return $queries;
    }

    public function test_opening_an_application_does_not_cost_a_query_per_person(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->actingAs($staff);

        $small = $this->cost($this->application($staff, $provider, 0, false));
        $large = $this->cost($this->application($staff, $provider, 4, true));

        // Settling a checklist reads that person's slots, so a family costs
        // a little more than a lone applicant by design. What must not happen
        // is a query per document: six people against a dozen requirements
        // each is seventy-odd slots, and before this was measured every one
        // of them fetched its own row, its file, and the application back.
        $perPerson = ($large - $small) / 5;

        $this->assertLessThanOrEqual(
            3,
            $perPerson,
            "Opening an application costs {$small} queries for one person and {$large} for "
            ."six: {$perPerson} per extra member, which is a question per document rather "
            ."than per person.",
        );
    }
}
