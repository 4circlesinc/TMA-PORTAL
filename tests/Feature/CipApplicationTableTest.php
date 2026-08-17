<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * §8 — the main application table.
 *
 * Nine columns, one row per application, and a family size the portal works
 * out rather than one somebody types.
 */
class CipApplicationTableTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function staff(string $email = 'ada@example.com'): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function provider(User $owner): CipProvider
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $owner->id]);

        return CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
    }

    /** An application with a family of `1 + sponsor + dependents`. */
    private function application(User $staff, CipProvider $provider, int $dependents, bool $sponsor): CipApplication
    {
        $application = Applications::create($provider, $staff, [
            'investment_type' => 'real_estate',
            'sponsored' => $sponsor,
        ]);

        $client = Client::create([
            'uid' => 'chen-wei-'.strtolower($application->internal_number),
            'name' => 'Chen Wei', 'email' => 'chen@example.com',
            'created_by' => $staff->id, 'data' => [],
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        $person = fn (string $role, string $first, ?int $ordinal = null) => CipPerson::create([
            'application_id' => $application->id, 'role' => $role,
            'first_name' => $first, 'last_name' => 'Wei',
            'dependent_ordinal' => $ordinal,
        ]);

        $person(CipPerson::ROLE_MAIN_APPLICANT, 'Chen');
        if ($sponsor) {
            $person(CipPerson::ROLE_SPONSOR, 'Li');
        }
        for ($i = 1; $i <= $dependents; $i++) {
            $person(CipPerson::ROLE_DEPENDENT, 'Kid'.$i, $i);
        }

        return $application->refresh();
    }

    public function test_the_table_carries_every_column_section_8_asks_for(): void
    {
        $staff = $this->staff();
        $this->application($staff, $this->provider($staff), 4, true);

        $row = $this->actingAs($staff)
            ->getJson('/portal/cip/applications')
            ->assertOk()
            ->json('applications.0');

        foreach ([
            'number', 'applicantName', 'provider', 'contactPerson', 'contactEmail',
            'investmentType', 'familyLabel', 'statusLabel', 'assignedTo',
        ] as $column) {
            $this->assertArrayHasKey($column, $row, $column.' is one of §8’s columns.');
        }

        $this->assertSame('Chen Wei', $row['applicantName']);
        $this->assertSame('Galaxy', $row['provider']);
        $this->assertSame('chen@example.com', $row['contactEmail']);
        $this->assertSame('New Applications', $row['statusLabel']);
        $this->assertSame(
            [[
                'value' => Status::REVIEW_APPLICATION,
                'label' => 'Review Applications',
                'tone' => 'action',
            ]],
            $row['availableTransitions'],
            'the row menu’s Change status list is the edges this reader may drive',
        );
    }

    public function test_the_assigned_column_names_the_staff_on_the_client(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff, $this->provider($staff), 1, false);

        $officer = User::create(['name' => 'Omar Reviewer', 'email' => 'omar@example.com', 'password' => bcrypt('password12345')]);
        $officer->forceFill(['status' => 'approved', 'account_type' => 'Employee'])->save();

        ClientAssignment::create([
            'client_id' => $application->client_id, 'user_id' => $officer->id,
            'assigned_by' => $staff->id, 'role' => 'case_officer',
            'permission_level' => 'editor', 'status' => ClientAssignment::STATUS_ACTIVE,
        ]);

        $row = $this->actingAs($staff)->getJson('/portal/cip/applications')->assertOk()->json('applications.0');

        /*
         * The client's list IS this column.
         *
         * The profile's Assigned tab and this cell are one record, so somebody
         * put on from either place shows in both. They used to be separate
         * tables, which meant staff added in the tab were invisible here and
         * assigning from here was invisible there.
         */
        $this->assertCount(1, $row['assignedTo']);
        $this->assertSame('Omar Reviewer', $row['assignedTo'][0]['name']);
    }

    public function test_an_assignment_that_has_ended_is_not_shown_as_assigned(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff, $this->provider($staff), 1, false);

        $gone = User::create(['name' => 'Left Already', 'email' => 'gone@example.com', 'password' => bcrypt('password12345')]);
        $gone->forceFill(['status' => 'approved', 'account_type' => 'Employee'])->save();

        ClientAssignment::create([
            'client_id' => $application->client_id, 'user_id' => $gone->id,
            'assigned_by' => $staff->id, 'role' => 'case_officer',
            'permission_level' => 'editor', 'status' => ClientAssignment::STATUS_ACTIVE,
            'ends_at' => now()->subDay(),
        ]);

        $row = $this->actingAs($staff)->getJson('/portal/cip/applications')->assertOk()->json('applications.0');

        $this->assertSame([], $row['assignedTo'], 'Somebody who has stopped is not assigned.');
    }

    public function test_family_size_is_counted_not_typed(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);

        // §8's own worked example: 1 main + 1 sponsor + 4 dependents = F6.
        $this->application($staff, $provider, 4, true);

        $row = $this->actingAs($staff)->getJson('/portal/cip/applications')->assertOk()->json('applications.0');

        $this->assertSame(6, $row['familySize']);
        $this->assertSame('F6', $row['familyLabel']);
    }

    public function test_a_lone_applicant_is_f1(): void
    {
        $staff = $this->staff();
        $this->application($staff, $this->provider($staff), 0, false);

        $row = $this->actingAs($staff)->getJson('/portal/cip/applications')->assertOk()->json('applications.0');

        $this->assertSame('F1', $row['familyLabel']);
    }

    public function test_the_table_does_not_ask_a_question_per_row(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        foreach (range(1, 5) as $i) {
            $this->application($staff, $provider, 3, true);
        }

        $this->actingAs($staff);
        DB::enableQueryLog();
        $this->getJson('/portal/cip/applications')->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        // Five applications of six people each. A per-row family count or a
        // per-row provider lookup would put this in the dozens.
        $this->assertLessThan(20, $count, 'The table must not scale its queries with its rows.');
    }

    public function test_it_lists_applications_not_clients(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->application($staff, $provider, 1, false);

        // A client with no application at all: they belong in the hub, not in
        // a table of applications.
        Client::create(['uid' => 'no-application', 'name' => 'Nobody', 'created_by' => $staff->id, 'data' => []]);

        $body = $this->actingAs($staff)->getJson('/portal/cip/applications')->assertOk()->json();

        $this->assertSame(1, $body['total']);
    }

    public function test_it_can_be_searched_by_number_or_applicant(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $wanted = $this->application($staff, $provider, 1, false);

        $find = fn (string $q) => $this->actingAs($staff)
            ->getJson('/portal/cip/applications?q='.urlencode($q))
            ->assertOk()->json('total');

        $this->assertSame(1, $find($wanted->internal_number));
        $this->assertSame(1, $find('Chen'));
        $this->assertSame(1, $find('Wei'));
        $this->assertSame(0, $find('Nobody at all'));
    }

    public function test_it_can_be_filtered_by_status(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->application($staff, $provider, 1, false);

        $this->assertSame(1, $this->actingAs($staff)
            ->getJson('/portal/cip/applications?status='.Status::NEW)->assertOk()->json('total'));

        $this->assertSame(0, $this->actingAs($staff)
            ->getJson('/portal/cip/applications?status='.Status::GRANTED)->assertOk()->json('total'));
    }

    public function test_it_pages(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        foreach (range(1, 3) as $i) {
            $this->application($staff, $provider, 0, false);
        }

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?perPage=2')
            ->assertOk()->json();

        $this->assertCount(2, $body['applications']);
        $this->assertSame(3, $body['total']);
        $this->assertSame(2, $body['lastPage']);
    }

    public function test_it_sorts_by_applicant_across_pages(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->named($this->application($staff, $provider, 0, false), 'Zed', 'Zane');
        $this->named($this->application($staff, $provider, 0, false), 'Ada', 'Able');

        $asc = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?sort=applicant&dir=asc')
            ->assertOk()
            ->json('applications');

        $this->assertSame(['Ada Able', 'Zed Zane'], array_column($asc, 'applicantName'));

        $desc = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?sort=applicant&dir=desc')
            ->assertOk()
            ->json('applications');

        $this->assertSame(['Zed Zane', 'Ada Able'], array_column($desc, 'applicantName'));

        $page = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?sort=applicant&dir=asc&perPage=1&page=2')
            ->assertOk()
            ->json();

        $this->assertSame('Zed Zane', $page['applications'][0]['applicantName']);
        $this->assertSame(2, $page['total']);
    }

    public function test_an_unknown_sort_keeps_newest_first(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->named($this->application($staff, $provider, 0, false), 'Ada', 'Able');
        $this->named($this->application($staff, $provider, 0, false), 'Zed', 'Zane');

        $names = array_column(
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications?sort=not-a-column&dir=asc')
                ->assertOk()
                ->json('applications'),
            'applicantName',
        );

        $this->assertSame(['Zed Zane', 'Ada Able'], $names);
    }

    public function test_it_sorts_by_family_size(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->application($staff, $provider, 4, true);
        $this->application($staff, $provider, 0, false);

        $labels = array_column(
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications?sort=family&dir=asc')
                ->assertOk()
                ->json('applications'),
            'familyLabel',
        );

        $this->assertSame(['F1', 'F6'], $labels);
    }

    public function test_sorting_does_not_ask_a_question_per_row(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        foreach (range(1, 5) as $i) {
            $this->application($staff, $provider, 3, true);
        }

        $this->actingAs($staff);
        DB::enableQueryLog();
        $this->getJson('/portal/cip/applications?sort=applicant&dir=asc')->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertLessThan(20, $count, 'A sorted listing must not scale its queries with its rows.');
    }

    public function test_it_sorts_status_in_lifecycle_order(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->application($staff, $provider, 0, false);
        $this->application($staff, $provider, 0, false)
            ->forceFill(['status' => Status::GRANTED])
            ->save();

        $labels = array_column(
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications?sort=status&dir=asc')
                ->assertOk()
                ->json('applications'),
            'statusLabel',
        );

        $this->assertSame(['New Applications', 'Approved'], $labels);
    }

    public function test_it_sorts_assigned_with_unassigned_last(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $held = $this->application($staff, $provider, 0, false);
        $this->application($staff, $provider, 0, false);

        $officer = User::create(['name' => 'Omar Reviewer', 'email' => 'omar-sort@example.com', 'password' => bcrypt('password12345')]);
        $officer->forceFill(['status' => 'approved', 'account_type' => 'Employee'])->save();

        ClientAssignment::create([
            'client_id' => $held->client_id, 'user_id' => $officer->id,
            'assigned_by' => $staff->id, 'role' => 'case_officer',
            'permission_level' => 'editor', 'status' => ClientAssignment::STATUS_ACTIVE,
        ]);

        $names = array_map(
            fn (array $row) => ($row['assignedTo'][0] ?? [])['name'] ?? '',
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications?sort=assigned&dir=asc')
                ->assertOk()
                ->json('applications'),
        );

        $this->assertSame(['Omar Reviewer', ''], $names);
    }

    private function named(CipApplication $application, string $first, string $last): CipApplication
    {
        $application->people()
            ->where('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->first()
            ->forceFill(['first_name' => $first, 'last_name' => $last])
            ->save();

        $application->client->forceFill(['name' => $first.' '.$last])->save();

        return $application->refresh();
    }
}
