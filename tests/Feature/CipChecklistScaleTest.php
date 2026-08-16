<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\Requirements;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Settling a checklist must not cost a query per requirement.
 *
 * An application is a family — a main applicant, a sponsor and up to four
 * dependants — and each of them owes a list the firm can lengthen from the
 * portal. Materialising once per template per person is the shape that turns a
 * routine save into forty round trips, and it is invisible until the firm adds
 * their real standards. This is the guard.
 */
class CipChecklistScaleTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function family(User $staff): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);

        $make = fn (string $role, string $first, ?int $ordinal = null) => CipPerson::create([
            'application_id' => $application->id, 'role' => $role,
            'first_name' => $first, 'last_name' => 'Haddad',
            'date_of_birth' => '1990-01-01', 'dependent_ordinal' => $ordinal,
        ]);

        $make(CipPerson::ROLE_MAIN_APPLICANT, 'Asem');
        $make(CipPerson::ROLE_SPONSOR, 'Maryam');
        foreach (range(1, 4) as $i) {
            $make(CipPerson::ROLE_DEPENDENT, 'Child'.$i, $i);
        }

        return $application->refresh();
    }

    public function test_settling_a_family_does_not_scale_with_the_requirements(): void
    {
        $staff = $this->staff();
        $application = $this->family($staff);

        // Ten more requirements per type than the defaults ship with. The
        // query count must not move with them.
        foreach (ApplicantType::ALL as $type) {
            foreach (range(1, 10) as $n) {
                CipDocumentRequirement::create([
                    'applicant_type' => $type,
                    'key' => 'extra_'.$n,
                    'label' => 'Extra document '.$n,
                    'required' => true,
                    'sort_order' => 100 + $n,
                ]);
            }
        }

        DB::enableQueryLog();
        Requirements::materialiseApplication($application);
        $first = count(DB::getQueryLog());
        DB::flushQueryLog();

        // The second run has nothing to create — the expensive shape shows up
        // here, where a per-template lookup would still cost the same as the
        // first pass.
        Requirements::materialiseApplication($application);
        $second = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertLessThan(
            60,
            $second,
            "Settling six people against fifteen requirements each took {$second} queries "
            ."(first pass {$first}). That is a query per requirement, not per person.",
        );
    }
}
