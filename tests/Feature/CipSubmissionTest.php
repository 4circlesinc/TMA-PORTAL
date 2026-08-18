<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Engine;
use App\Support\Cip\Milestones;
use App\Support\Cip\Status;
use App\Support\Cip\Submission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * §16 — recording a submission to the Unit.
 *
 * After the provider has confirmed, staff enter the submission date and the
 * CIP application number. The file moves to Pending review, and every surface
 * that renders displayNumber() starts calling it by the Unit's number.
 */
class CipSubmissionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email = 'ada@example.com', string $name = 'Ada Admin'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function provider(User $owner): CipProvider
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $owner->id]);

        return CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
    }

    /** Confirmed and ready to submit — the door §16 opens. */
    private function ready(User $staff, ?CipProvider $provider = null, string $clientName = 'Chen Wei'): CipApplication
    {
        $application = Applications::create($provider ?? $this->provider($staff), $staff);

        $client = Client::create([
            'uid' => \Illuminate\Support\Str::slug($clientName).'-'.strtolower($application->internal_number),
            'name' => $clientName, 'created_by' => $staff->id, 'data' => [],
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => strtok($clientName, ' ') ?: $clientName,
            'last_name' => (str_contains($clientName, ' ') ? substr($clientName, strpos($clientName, ' ') + 1) : 'Wei'),
        ]);

        foreach ([Status::REVIEW_APPLICATION, Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT] as $to) {
            Engine::apply($application, $to, $staff);
        }

        $application->forceFill(['locked_at' => now()])->save();

        return $application->refresh();
    }

    public function test_recording_the_date_and_cip_number_moves_the_file_to_pending_review(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->ready($staff);
        $internal = $application->internal_number;

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
                'submittedAt' => '2026-08-10',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PENDING_REVIEW, $body['status']);
        $this->assertSame('Pending Review', $body['statusLabel']);
        $this->assertSame('10T1G12661P', $body['number'], 'The CIP number is now the primary reference.');
        $this->assertSame('10T1G12661P', $body['cipNumber']);
        $this->assertSame($internal, $body['internalNumber']);
        $this->assertSame('2026-08-10', $body['submittedAt']);

        $submitted = collect($body['milestones'])->firstWhere('key', Milestones::SUBMITTED);
        $this->assertTrue($submitted['reached']);
        $this->assertSame('2026-08-10', $submitted['date']);

        $application = $application->fresh();
        $this->assertSame(Status::PENDING_REVIEW, $application->status);
        $this->assertSame('10T1G12661P', $application->displayNumber());
        $this->assertSame('2026-08-10', $application->submitted_at->toDateString());
    }

    public function test_the_applications_table_names_the_file_by_the_cip_number(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->ready($staff);

        Submission::record($application, $staff, '10T1G12661P', now()->startOfDay());

        $row = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?q=10T1G12661P')
            ->assertOk()
            ->json('applications.0');

        $this->assertSame('10T1G12661P', $row['number']);
        $this->assertSame($application->internal_number, $row['internalNumber']);
        $this->assertSame('Pending Review', $row['statusLabel']);

        $this->assertSame(1, $this->actingAs($staff)
            ->getJson('/portal/cip/applications?q='.urlencode($application->internal_number))
            ->assertOk()->json('total'), 'The internal number still finds it.');
    }

    public function test_the_submission_date_and_number_are_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->ready($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'submittedAt' => '2026-08-10',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('cipNumber');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('submittedAt');

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
        $this->assertNull($application->fresh()->cip_number);
        $this->assertNull($application->fresh()->submitted_at);
    }

    public function test_a_compliance_officer_may_record_the_submission(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->ready($admin);
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        Assignments::assign($application->fresh(), $colin, $admin, CipAccess::COMPLIANCE_OFFICER);

        $this->actingAs($colin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
                'submittedAt' => '2026-08-10',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_REVIEW)
            ->assertJsonPath('application.number', '10T1G12661P');
    }

    public function test_a_reviewing_officer_cannot_record_the_submission(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->ready($admin);
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        Assignments::assign($application->fresh(), $rita, $admin, CipAccess::REVIEWING_OFFICER);

        $this->actingAs($rita)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
                'submittedAt' => '2026-08-10',
            ])
            ->assertForbidden();

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
        $this->assertNull($application->fresh()->cip_number);
    }

    public function test_the_status_endpoint_is_not_a_way_around_recording_the_number(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->ready($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PENDING_REVIEW,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
        $this->assertNull($application->fresh()->cip_number);
    }

    public function test_a_wrong_status_is_the_caller_s_mistake_not_a_server_fault(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = Applications::create($this->provider($staff), $staff);
        $application->forceFill(['locked_at' => now()])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
                'submittedAt' => '2026-08-10',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::NEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->cip_number);
        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_NUMBER_ASSIGNED)->count());
    }
}
