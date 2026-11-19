<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Distribution;
use App\Support\Cip\Engine;
use App\Support\Cip\Notices;
use App\Support\Cip\Phase;
use App\Support\Cip\Stages;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The firm's administrators skip the lifecycle's requirements.
 *
 * No status is blocked for them: either lane, a dated step from anywhere,
 * Delayed, a decision already recorded, a checklist that is not finished.
 * What a verb asks for — a decision letter, the Unit's number, a confirmed
 * package, a reason — is optional. Each move asks whether to notify the
 * file's service provider and assigned staff, and an edit may tell them too.
 *
 * Everybody else keeps the lifecycle's rules; the tests for those rules run
 * as a reviewing officer.
 */
class CipAdminSkipsRequirementsTest extends TestCase
{
    use RefreshDatabase;

    private User $ada;

    private User $rita;

    private User $gil;

    private CipProvider $provider;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Distribution::flush();
        $this->travelTo('2026-08-18 12:00:00');

        $this->ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $this->rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $this->gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $this->ada->id]);
        $this->provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $this->gil->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $this->ada->id,
        ]);
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function application(string $status = Status::NEW, array $attributes = []): CipApplication
    {
        $application = Applications::create($this->provider, $this->ada, $attributes);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => $status])->save();

        return $application->fresh();
    }

    private function move(User $user, CipApplication $application, string $to, array $extra = [])
    {
        return $this->actingAs($user)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/status',
            array_merge(['status' => $to], $extra),
        );
    }

    public function test_an_administrator_is_offered_every_status_and_nobody_else_is(): void
    {
        $this->assertTrue(CipAccess::skipsRequirements($this->ada));
        $this->assertFalse(CipAccess::skipsRequirements($this->rita));

        $application = $this->application();
        $offered = Engine::availableOverrides($application, $this->ada);

        foreach ([Status::GRANTED, Status::BACKGROUND_CHECK, Status::DELAYED, Status::PENDING_COR, Status::PASSPORT_DELIVERED, Status::POST_APPROVAL] as $any) {
            $this->assertContains($any, $offered, $any.' was not offered to an administrator');
        }
        $this->assertNotContains(Status::NEW, $offered, 'not where it already stands');
        $this->assertSame([], Engine::availableOverrides($application, $this->rita));

        // An Add-On's statuses are its own lane: the post-approval lane is
        // not the Add-On's vocabulary at all.
        $addOn = $this->application(Status::PENDING_REVIEW, ['phase' => Phase::ADD_ON]);
        $addOnOffered = array_merge(
            Engine::availableTransitions($addOn, $this->ada),
            Engine::availableOverrides($addOn, $this->ada),
        );
        $this->assertContains(Status::DD_QUERY, $addOnOffered);
        $this->assertNotContains(Status::POST_APPROVAL, $addOnOffered);
        $this->assertNotContains(Status::PENDING_COR, $addOnOffered);
    }

    public function test_an_administrator_sets_any_status_and_the_lane_follows(): void
    {
        Mail::fake();
        $application = $this->application();

        // Straight to Approved: no decision dialog, no letter. The decision
        // column says what the chip says; the day is left to be recorded.
        $this->move($this->ada, $application, Status::GRANTED)->assertOk()
            ->assertJsonPath('application.status', Status::GRANTED);
        $this->assertSame(Status::GRANTED, $application->fresh()->decision);

        // A post-approval status on a pre-approval file makes it one.
        $this->move($this->ada, $application, Status::PENDING_COR)->assertOk();
        $this->assertSame(Status::PENDING_COR, $application->fresh()->status);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);
        $this->assertNotNull($application->fresh()->post_approval_at);

        // And a pre-approval status takes it back, no reason demanded.
        $this->move($this->ada, $application, Status::ASSESSMENT_FEEDBACK)->assertOk();
        $this->assertSame(Status::ASSESSMENT_FEEDBACK, $application->fresh()->status);
        $this->assertSame(Phase::PRE_APPROVAL, $application->fresh()->phase);

        // Delayed by hand, Background Check without the accepted date.
        $this->move($this->ada, $application, Status::DELAYED)->assertOk();
        $this->move($this->ada, $application, Status::BACKGROUND_CHECK)->assertOk();
        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);

        // The same moves stay refused to an officer.
        $this->move($this->rita, $application, Status::GRANTED)->assertStatus(422);
        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
    }

    public function test_a_draft_is_filed_first_even_by_an_administrator(): void
    {
        $draft = $this->application(Status::DRAFT);

        $this->move($this->ada, $draft, Status::GRANTED)->assertStatus(422);
        $this->assertSame(Status::DRAFT, $draft->fresh()->status);
    }

    public function test_an_administrator_decides_without_a_letter_and_may_change_the_decision(): void
    {
        Mail::fake();
        $application = $this->application(Status::REVIEW_APPLICATION);
        $decide = fn (string $decision) => $this->actingAs($this->ada)->post(
            '/portal/cip/applications/'.$application->uuid.'/decision',
            ['decision' => $decision, 'decidedAt' => '2026-08-17'],
            ['Accept' => 'application/json', 'X-Requested-With' => 'XMLHttpRequest'],
        );

        $decide(Status::GRANTED)->assertOk();
        $this->assertSame(Status::GRANTED, $application->fresh()->status);
        $this->assertSame('2026-08-17', $application->fresh()->decided_at->toDateString());
        $this->assertNull($application->fresh()->decision_letter_file_id);

        $decide(Status::DENIED)->assertOk();
        $this->assertSame(Status::DENIED, $application->fresh()->status);
        $this->assertSame(Status::DENIED, $application->fresh()->decision);
    }

    public function test_an_administrator_records_a_submission_with_no_number_and_no_confirmation(): void
    {
        Mail::fake();
        $application = $this->application(Status::REVIEW_APPLICATION);
        $this->assertNull($application->locked_at);

        $this->actingAs($this->ada)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'submittedAt' => '2026-08-16',
            ])
            ->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::PENDING_REVIEW, $fresh->status);
        $this->assertNull($fresh->cip_number);
        $this->assertSame('2026-08-16', $fresh->submitted_at->toDateString());
    }

    public function test_an_administrator_records_a_dated_step_from_anywhere(): void
    {
        Mail::fake();
        $application = $this->application(Status::NEW);

        $this->actingAs($this->ada)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::NIC_SUBMITTED,
                'date' => '2026-08-15',
            ])
            ->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::PENDING_NIC, $fresh->status);
        $this->assertSame('2026-08-15', $fresh->nic_submitted_at->toDateString());
        $this->assertSame(Phase::POST_APPROVAL, $fresh->phase);
    }

    public function test_an_administrator_chooses_whether_a_move_notifies_the_provider_and_assigned_staff(): void
    {
        Mail::fake();
        $application = $this->application();
        Assignments::assign($application->fresh(), $this->rita, $this->ada);

        // Unticked: neither the provider nor the officer holding the file
        // hears of it; an address typed into CC still gets its copy.
        Mail::fake();
        $belled = fn () => \Illuminate\Support\Facades\DB::table('portal_notifications')->where('user_id', $this->gil->id)->count();
        $before = $belled();
        $this->move($this->ada, $application, Status::ASSESSMENT_FEEDBACK, [
            'notify' => false,
            'cc' => 'partner@example.com',
        ])->assertOk();

        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('partner@example.com'));
        $this->assertSame($before, $belled(), 'No bell for the provider either.');

        // Ticked, or not sent at all: the usual notice.
        Mail::fake();
        $this->move($this->ada, $application, Status::UPDATE_REQUIRED, ['notify' => true])->assertOk();
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));

        // Only an administrator may hold a notice back.
        Mail::fake();
        $this->move($this->rita, $application, Status::ASSESSMENT_FEEDBACK, ['notify' => false])->assertOk();
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
    }

    public function test_an_edit_can_tell_the_provider_and_assigned_staff(): void
    {
        Mail::fake();
        $application = $this->application(Status::REVIEW_APPLICATION);
        Assignments::assign($application->fresh(), $this->rita, $this->ada);

        Mail::fake();
        Notices::edited($application->fresh(), $this->ada, 'Corrected the spelling of the applicant\'s name.');

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example')
            && str_contains((string) json_encode($mail->payload), 'Corrected the spelling'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        // Not to the administrator who made the edit.
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $this->gil->id,
            'type' => 'cip.application-updated',
        ]);
    }

    public function test_an_administrator_enters_the_cip_number_at_any_status(): void
    {
        $application = $this->application(Status::REVIEW_APPLICATION);

        $this->actingAs($this->ada)
            ->patchJson('/portal/cip/applications/'.$application->uuid.'/cip-number', [
                'cipNumber' => '10T1G99999P',
            ])
            ->assertOk();

        $this->assertSame('10T1G99999P', $application->fresh()->cip_number);
        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);

        $shown = $this->actingAs($this->ada)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');
        $this->assertTrue($shown['canAssignCipNumber']);
        $this->assertTrue($shown['skipsRequirements']);
    }
}
