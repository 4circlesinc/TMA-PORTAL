<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Confirmation;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Status;
use App\Support\Cip\Submission;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * §15 — Ready to submit, confirm, lock.
 *
 * Approving the last document auto-flips the application. The service provider
 * then confirms, which freezes the original package so nobody — provider or
 * staff — can rewrite what is about to go to the Unit.
 */
class CipConfirmationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
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

    private function application(User $staff, string $status, ?Company &$company = null): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);

        $application = Applications::create($provider, $staff);
        $application->forceFill(['status' => $status])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application;
    }

    private function slot(
        CipApplication $application,
        string $type,
        string $label,
        string $status = DocumentStatus::READY_FOR_SUBMISSION,
    ): CipDocument {
        $slot = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $application->people()->value('id'),
            'type' => $type,
            'label' => $label,
            'required' => true,
        ]);

        $slot->forceFill(['status' => $status])->save();

        return $slot;
    }

    private function officer(CipApplication $holds): User
    {
        $officer = User::firstWhere('email', 'rita@example.com')
            ?? $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');

        CipApplicationAssignment::firstOrCreate([
            'application_id' => $holds->id,
            'user_id' => $officer->id,
            'status' => CipApplicationAssignment::STATUS_ACTIVE,
        ], [
            'role' => 'reviewing_officer',
            'assigned_by' => $officer->id,
            'starts_at' => now(),
        ]);

        return $officer;
    }

    private function contact(Company $company, User $staff): User
    {
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        return $contact;
    }

    public function test_the_service_provider_confirms_and_the_package_locks(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $body = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk()
            ->json('application');

        $this->assertTrue($body['locked']);
        $this->assertFalse($body['canConfirm']);
        $this->assertSame(Status::READY_TO_SUBMIT, $body['status']);
        $this->assertNotNull($application->fresh()->locked_at);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_PACKAGE_CONFIRMED,
            'actor_id' => $contact->id,
        ]);
    }

    public function test_confirming_tells_the_firm_to_record_the_submission(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk();

        // The press only the provider can make lands with the people whose
        // move is next — not only in the activity trail.
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $staff->id,
            'type' => 'cip.package_confirmed',
        ]);
    }

    /**
     * The day the package froze is recorded, not assumed.
     *
     * "When did this stop being changeable" is the first question asked of a
     * package the Unit later queries, and a firm entering a file it confirmed
     * last week had today stamped on it with nothing to say otherwise. Left
     * optional rather than required: the press is nearly always on the day,
     * and the dates that are required are the ones read off a government
     * letter with a date printed on it.
     */
    public function test_the_day_the_package_was_confirmed_is_the_day_given(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm', [
                'lockedAt' => '2026-08-17',
            ])
            ->assertOk()
            ->assertJsonPath('application.locked', true);

        $this->assertSame('2026-08-17', $application->fresh()->locked_at->toDateString());

        $meta = CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_PACKAGE_CONFIRMED)
            ->value('meta');
        $this->assertSame('2026-08-17', $meta['lockedAt']);
    }

    public function test_confirming_without_a_day_is_still_today(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk();

        $this->assertSame(
            now()->toDateString(),
            $application->fresh()->locked_at->toDateString(),
        );
    }

    public function test_non_admin_staff_cannot_confirm_submission(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($staff, Status::READY_TO_SUBMIT);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');

        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertForbidden();

        $this->assertNull($application->fresh()->locked_at);
    }

    /**
     * The one exception to "the press is the provider's": an administrator
     * may confirm on the provider's behalf, and the event says it was an
     * override rather than passing as the provider's own press.
     */
    public function test_an_administrator_can_confirm_on_the_providers_behalf(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($staff, Status::READY_TO_SUBMIT);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk()
            ->json('application');

        $this->assertTrue($body['locked']);
        $this->assertNotNull($application->fresh()->locked_at);

        $meta = CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_PACKAGE_CONFIRMED)
            ->value('meta');
        $this->assertTrue($meta['override']);
        $this->assertSame($staff->id, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_PACKAGE_CONFIRMED)
            ->value('actor_id'));
    }

    public function test_the_providers_own_press_is_not_marked_an_override(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk();

        $meta = CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_PACKAGE_CONFIRMED)
            ->value('meta');
        $this->assertArrayNotHasKey('override', $meta);
    }

    public function test_a_stranger_is_not_told_the_application_exists(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::READY_TO_SUBMIT);

        $this->actingAs($this->user(Role::CLIENT, 'nobody@example.com'))
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertNotFound();
    }

    public function test_confirming_twice_is_the_state_it_already_is(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')->assertOk();

        $lockedAt = $application->fresh()->locked_at;

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk()
            ->assertJsonPath('application.locked', true);

        $this->assertEquals($lockedAt->timestamp, $application->fresh()->locked_at->timestamp);
        $this->assertSame(1, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_PACKAGE_CONFIRMED)
            ->count());
    }

    public function test_an_application_that_is_not_ready_cannot_be_confirmed(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::ASSESSMENT_FEEDBACK, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertStatus(422);

        $this->assertNull($application->fresh()->locked_at);
    }

    public function test_the_show_payload_offers_confirm_to_the_provider_and_the_admin(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $contact = $this->contact($company, $staff);

        $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.canConfirm', true)
            ->assertJsonPath('application.locked', false);

        // The admin holds the override, so the button is offered rather than
        // the waiting-for-the-provider note.
        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.canConfirm', true)
            ->assertJsonPath('application.locked', false);

        $this->actingAs($this->officer($application))
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.canConfirm', false)
            ->assertJsonPath('application.locked', false);
    }

    public function test_a_locked_package_refuses_a_new_upload(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);

        Confirmation::confirm($application, $contact);

        $this->expectException(\InvalidArgumentException::class);
        DocumentSlots::fill(
            $application->people()->first(),
            'passport_bio_page',
            UploadedFile::fake()->create('rescan.pdf', 40, 'application/pdf'),
            $contact,
        );
    }

    public function test_a_locked_package_refuses_a_reviewer_verdict(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::READY_TO_SUBMIT, $company);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $contact = $this->contact($company, $staff);
        Confirmation::confirm($application->fresh(), $contact);

        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/request-changes', [
                'comment' => 'Too late — the package is frozen.',
            ])
            ->assertStatus(422);

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $passport->fresh()->status);
    }

    public function test_a_locked_original_file_cannot_be_replaced(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::REVIEW_APPLICATION, $company);
        $contact = $this->contact($company, $staff);
        $person = $application->people()->first();

        $slot = DocumentSlots::fill(
            $person,
            'passport_bio_page',
            UploadedFile::fake()->create('passport.pdf', 40, 'application/pdf'),
            $contact,
        );
        $slot->forceFill(['status' => DocumentStatus::READY_FOR_SUBMISSION])->save();
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        Confirmation::confirm($application->fresh(), $contact);

        $file = $slot->fresh()->file;

        $this->assertFalse(FileAccess::can($staff, 'upload', $file));
        $this->assertFalse(FileAccess::can($staff, 'delete', $file));
        $this->assertFalse(FileAccess::can($contact, 'upload', $file));
        $this->assertTrue(FileAccess::can($staff, 'view', $file));
    }

    public function test_staff_cannot_record_the_cip_number_before_the_provider_confirms(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::READY_TO_SUBMIT);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');

        try {
            Submission::record($application, $staff, '10T1G12661P');
            $this->fail('Recording a CIP number skipped confirm submission.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('confirm submission', $e->errors()['cipNumber'][0]);
        }

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
        $this->assertNull($application->fresh()->cip_number);
    }
}
