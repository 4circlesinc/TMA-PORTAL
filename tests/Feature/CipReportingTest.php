<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Report;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * §25 — administrators generate CIP reports by the brief's filters, and the
 * seven named examples are those filters already filled in.
 *
 * The existing reporting pipeline (request row + stored answer + CSV) is the
 * surface; this pins that CIP is a type on it, not a second page.
 */
class CipReportingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.cip.enabled' => true]);
        $this->travelTo('2026-08-18 12:00:00');
    }

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function application(
        User $creator,
        CipProvider $provider,
        string $status,
        array $attributes = [],
        string $first = 'Chen',
        string $last = 'Wei',
    ): CipApplication {
        $application = Applications::create($provider, $creator, [
            'investment_type' => $attributes['investment_type'] ?? InvestmentType::REAL_ESTATE,
        ]);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => $first,
            'last_name' => $last,
        ]);

        $fill = array_merge(['status' => $status], $attributes);
        unset($fill['investment_type']);
        $application->forceFill($fill)->save();

        return $application->refresh();
    }

    private function create(User $as, array $body = []): array
    {
        return $this->actingAs($as)
            ->postJson('/admin/reports', array_merge([
                'type' => Report::TYPE_CIP,
                'range' => 'all',
            ], $body))
            ->assertCreated()
            ->json('report');
    }

    private function metric(array $report, string $label): ?string
    {
        foreach ($report['data']['metrics'] ?? [] as $metric) {
            if ($metric['label'] === $label) {
                return $metric['value'];
            }
        }

        return null;
    }

    /** @return list<list<string>> */
    private function rows(array $report): array
    {
        return $report['data']['table']['rows'] ?? [];
    }

    /* ── the page offers CIP when the module is on ─────────────────── */

    public function test_the_reporting_page_offers_cip_types_presets_and_all_dates(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');

        $index = $this->actingAs($admin)->getJson('/admin/reports')->assertOk()->json();

        $this->assertContains('cip', collect($index['types'])->pluck('value')->all());
        $this->assertContains('all', collect($index['ranges'])->pluck('value')->all());
        $this->assertCount(7, $index['cip']['presets']);
        $this->assertSame('Applications Pending Review', $index['cip']['presets'][0]['label']);
    }

    public function test_cip_is_omitted_and_refused_while_the_module_is_dark(): void
    {
        config(['services.cip.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');

        $index = $this->actingAs($admin)->getJson('/admin/reports')->assertOk()->json();

        $this->assertNotContains('cip', collect($index['types'])->pluck('value')->all());
        $this->assertNull($index['cip']);

        $this->actingAs($admin)
            ->postJson('/admin/reports', ['type' => 'cip', 'range' => 'all'])
            ->assertStatus(422);

        $this->assertSame(0, Report::count());
    }

    /* ── the seven presets ─────────────────────────────────────────── */

    public function test_each_named_preset_returns_the_matching_slice(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $horizon = CipProvider::create(['name' => 'Horizon', 'code' => 'HOR']);

        $this->application($admin, $galaxy, Status::PENDING_REVIEW);
        $this->application($admin, $galaxy, Status::BACKGROUND_CHECK);
        $this->application($admin, $galaxy, Status::DELAYED, [
            'investment_type' => InvestmentType::ENTERPRISE_PROJECT,
        ]);
        $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => '2026-08-01',
            'cip_number' => '10T1G12661P',
            'submitted_at' => '2026-02-01',
        ]);
        $this->application($admin, $horizon, Status::DENIED, [
            'decision' => CipApplication::DECISION_DENIED,
            'decided_at' => '2026-08-02',
            'investment_type' => InvestmentType::NATIONAL_ACTION_BONDS,
        ]);

        $pending = $this->create($admin, ['filters' => ['preset' => 'pending_review']]);
        $this->assertSame('Applications Pending Review: All dates', $pending['name']);
        $this->assertSame('1', $this->metric($pending, 'Applications'));
        $this->assertSame('Pending Review', $this->rows($pending)[0][2]);
        $this->assertNull($pending['data']['window']['from']);
        $this->assertNull($pending['data']['window']['to']);

        $background = $this->create($admin, ['filters' => ['preset' => 'background_check']]);
        $this->assertSame('Applications in Background Check: All dates', $background['name']);
        $this->assertSame('1', $this->metric($background, 'Applications'));
        $this->assertSame('Background Check', $this->rows($background)[0][2]);

        $delayed = $this->create($admin, ['filters' => ['preset' => 'delayed']]);
        $this->assertSame('Delayed Applications: All dates', $delayed['name']);
        $this->assertSame('1', $this->metric($delayed, 'Applications'));
        $this->assertSame('Delayed', $this->rows($delayed)[0][2]);

        $grantedReport = $this->create($admin, ['filters' => ['preset' => 'granted']]);
        $this->assertSame('Granted Applications: All dates', $grantedReport['name']);
        $this->assertSame('1', $this->metric($grantedReport, 'Applications'));
        $this->assertSame('10T1G12661P', $this->rows($grantedReport)[0][0], 'the Number column is displayNumber()');
        $this->assertSame('Approved', $this->rows($grantedReport)[0][2], 'the status chip still says Approved');

        $denied = $this->create($admin, ['filters' => ['preset' => 'denied']]);
        $this->assertSame('Denied Applications: All dates', $denied['name']);
        $this->assertSame('1', $this->metric($denied, 'Applications'));
        $this->assertSame('Denied', $this->rows($denied)[0][2]);

        $byProvider = $this->create($admin, ['filters' => ['preset' => 'by_provider']]);
        $this->assertSame('Applications by Service Provider: All dates', $byProvider['name']);
        $this->assertSame(['Service provider', 'Applications'], $byProvider['data']['table']['columns']);
        $this->assertSame(['Galaxy', '4'], $this->rows($byProvider)[0]);
        $this->assertSame(['Horizon', '1'], $this->rows($byProvider)[1]);

        $byType = $this->create($admin, ['filters' => ['preset' => 'by_investment_type']]);
        $this->assertSame('Applications by Investment Type: All dates', $byType['name']);
        $grouped = collect($this->rows($byType))->mapWithKeys(fn ($row) => [$row[0] => $row[1]])->all();
        $this->assertSame('3', $grouped['Real Estate Project']);
        $this->assertSame('1', $grouped['Enterprise Project']);
        $this->assertSame('1', $grouped['National Action Bonds']);
    }

    /* ── combined filters ──────────────────────────────────────────── */

    public function test_provider_investment_type_and_date_range_combine(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $horizon = CipProvider::create(['name' => 'Horizon', 'code' => 'HOR']);

        $match = $this->application($admin, $galaxy, Status::PENDING_REVIEW, [
            'investment_type' => InvestmentType::REAL_ESTATE,
        ]);
        $this->application($admin, $galaxy, Status::PENDING_REVIEW, [
            'investment_type' => InvestmentType::ENTERPRISE_PROJECT,
        ]);
        $this->application($admin, $horizon, Status::PENDING_REVIEW, [
            'investment_type' => InvestmentType::REAL_ESTATE,
        ]);
        $old = $this->application($admin, $galaxy, Status::PENDING_REVIEW, [
            'investment_type' => InvestmentType::REAL_ESTATE,
        ]);
        $old->forceFill(['created_at' => now()->subDays(40)])->saveQuietly();

        $report = $this->create($admin, [
            'range' => 'last_30',
            'filters' => [
                'providerId' => $galaxy->id,
                'investmentType' => InvestmentType::REAL_ESTATE,
            ],
        ]);

        $this->assertSame('1', $this->metric($report, 'Applications'));
        $this->assertSame($match->internal_number, $this->rows($report)[0][0]);
        $this->assertSame(now()->subDays(29)->toDateString(), $report['data']['window']['from']);
        $this->assertSame(now()->toDateString(), $report['data']['window']['to']);
    }

    public function test_granted_date_range_reads_decision_date_not_created_at(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $inside = $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now()->subDays(5)->toDateString(),
        ]);
        $inside->forceFill(['created_at' => now()->subDays(40)])->saveQuietly();

        $outside = $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now()->subDays(40)->toDateString(),
        ]);

        $report = $this->create($admin, [
            'range' => 'last_30',
            'filters' => ['preset' => 'granted'],
        ]);

        $this->assertSame('1', $this->metric($report, 'Applications'));
        $this->assertSame($inside->internal_number, $this->rows($report)[0][0]);
        $this->assertNotSame($outside->internal_number, $this->rows($report)[0][0]);
    }

    public function test_applicant_officer_submitted_and_decided_filters(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $chen = $this->application($admin, $galaxy, Status::PENDING_REVIEW, [
            'assigned_officer_id' => $rita->id,
            'submitted_at' => '2026-02-01',
        ], 'Chen', 'Wei');
        $this->application($admin, $galaxy, Status::PENDING_REVIEW, [
            'submitted_at' => '2026-06-01',
        ], 'Pat', 'Lee');
        $granted = $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => '2026-08-10',
            'assigned_officer_id' => $rita->id,
        ], 'Chen', 'Wei');

        $byApplicant = $this->create($admin, ['filters' => ['applicant' => 'Chen']]);
        $this->assertSame('2', $this->metric($byApplicant, 'Applications'));

        $byOfficer = $this->create($admin, ['filters' => ['officerId' => $rita->id]]);
        $this->assertSame('2', $this->metric($byOfficer, 'Applications'));

        $bySubmitted = $this->create($admin, [
            'filters' => ['submittedFrom' => '2026-01-01', 'submittedTo' => '2026-03-01'],
        ]);
        $this->assertSame('1', $this->metric($bySubmitted, 'Applications'));
        $this->assertSame($chen->internal_number, $this->rows($bySubmitted)[0][0]);

        $byDecided = $this->create($admin, [
            'filters' => ['decidedFrom' => '2026-08-01', 'decidedTo' => '2026-08-18'],
        ]);
        $this->assertSame('1', $this->metric($byDecided, 'Applications'));
        $this->assertSame($granted->internal_number, $this->rows($byDecided)[0][0]);
    }

    public function test_a_withdrawn_application_still_counts(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $live = $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => '2026-08-01',
        ]);
        $binned = $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => '2026-08-02',
        ]);
        $binned->delete();

        $report = $this->create($admin, ['filters' => ['preset' => 'granted']]);

        $this->assertSame('2', $this->metric($report, 'Applications'));
        $numbers = collect($this->rows($report))->pluck(0)->all();
        $this->assertContains($live->internal_number, $numbers);
        $this->assertContains($binned->internal_number, $numbers);
    }

    public function test_csv_matches_the_on_screen_table(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $this->application($admin, $galaxy, Status::GRANTED, [
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => '2026-08-01',
            'cip_number' => '10T1G12661P',
        ]);

        $report = $this->create($admin, ['filters' => ['preset' => 'granted']]);
        $csv = $this->actingAs($admin)->get('/admin/reports/'.$report['id'].'/export')
            ->assertOk()
            ->streamedContent();

        $this->assertStringContainsString('Granted Applications: All dates', $csv);
        $this->assertStringContainsString('All dates', $csv);
        $this->assertStringContainsString('Number,Applicant,Status,"Service provider","Investment type","Assigned officer",Submitted,"Decision date"', $csv);
        $this->assertStringContainsString('10T1G12661P', $csv);
        $this->assertStringContainsString('Chen Wei', $csv);
        $this->assertStringContainsString('Approved', $csv);
        $this->assertStringContainsString('Galaxy', $csv);
        $this->assertStringContainsString('2026-08-01', $csv);

        foreach ($this->rows($report)[0] as $cell) {
            $this->assertStringContainsString($cell, $csv);
        }
    }
}
