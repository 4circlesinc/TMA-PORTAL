<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Notification;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Decision;
use App\Support\Cip\Milestones;
use App\Support\Cip\Status;
use App\Support\Cip\Timeline;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §21 — the Unit decided: record the date and Granted or Denied.
 *
 * The dedicated verb exists so `decision` and `decided_at` cannot be left
 * empty by a bare status change. The file becomes terminal, and the three
 * named classes are told.
 */
class CipDecisionTest extends TestCase
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

    private function inBackgroundCheck(User $staff, ?Company &$company = null): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        $application->forceFill([
            'status' => Status::BACKGROUND_CHECK,
            'cip_number' => '10T1G12661P',
            'submitted_at' => '2026-02-01',
            'accepted_at' => '2026-02-18',
            'locked_at' => now(),
        ])->save();

        return $application->refresh();
    }

    public function test_recording_granted_moves_the_file_to_approved(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::GRANTED, $body['status']);
        $this->assertSame('Approved', $body['statusLabel']);
        $this->assertSame(Status::GRANTED, $body['decision']);
        $this->assertSame('2026-08-18', $body['decidedAt']);

        $show = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');
        $this->assertSame('2026-08-18', $show['decidedAt']);
        $this->assertSame(Status::GRANTED, $show['decision']);
        $step = collect($show['milestones'])->firstWhere('key', Milestones::DECISION);
        $this->assertTrue($step['reached']);
        $this->assertSame('2026-08-18', $step['date']);
        $this->assertSame('Approved', $step['label']);

        $fresh = $application->fresh();
        $this->assertSame(Status::GRANTED, $fresh->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $fresh->decision);
        $this->assertSame('2026-08-18', $fresh->decided_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_DECISION_RECORDED,
            'actor_id' => $staff->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::BACKGROUND_CHECK,
            'to_status' => Status::GRANTED,
        ]);

        $this->assertSame(
            'Ada Admin recorded the decision: Approved on 2026-08-18',
            Timeline::for($fresh, $staff)[0]['what'],
        );
    }

    public function test_recording_denied_moves_the_file_to_denied(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::DENIED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::DENIED)
            ->assertJsonPath('application.statusLabel', 'Denied')
            ->assertJsonPath('application.decision', Status::DENIED);

        $this->assertSame(Status::DENIED, $application->fresh()->status);
        $this->assertSame(
            'Ada Admin recorded the decision: Denied on 2026-08-18',
            Timeline::for($application->fresh(), $staff)[0]['what'],
        );
    }

    public function test_a_delayed_file_can_be_decided(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        $application->forceFill(['status' => Status::DELAYED])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::GRANTED);
    }

    public function test_the_decision_date_and_type_are_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['decision', 'decidedAt']);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('decidedAt');

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        $this->assertNull($application->fresh()->decision);
        $this->assertNull($application->fresh()->decided_at);
    }

    public function test_a_compliance_officer_may_record_a_decision(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin);
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        Assignments::assign($application->fresh(), $colin, $admin, CipAccess::COMPLIANCE_OFFICER);

        $this->actingAs($colin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::DENIED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::DENIED);
    }

    public function test_an_officer_may_record_a_decision(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin);
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        Assignments::assign($application->fresh(), $rita, $admin);

        $this->actingAs($rita)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::GRANTED);
    }

    public function test_the_status_endpoint_is_not_a_way_around_recording_the_date(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::GRANTED,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        $this->assertNull($application->fresh()->decision);
        $this->assertNull($application->fresh()->decided_at);
    }

    public function test_a_file_the_unit_has_not_accepted_cannot_be_decided(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        $application->forceFill(['status' => Status::PENDING_REVIEW])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->decision);
        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_DECISION_RECORDED)->count());
    }

    public function test_recording_again_updates_the_date_without_a_second_move_or_notice(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        Decision::record($application, $staff, Status::GRANTED, now()->startOfDay()->setDate(2026, 8, 10));
        $mails = count(Mail::sent(Postcard::class));
        $this->assertGreaterThan(0, $mails);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.decidedAt', '2026-08-18')
            ->assertJsonPath('application.status', Status::GRANTED);

        $this->assertSame(1, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::GRANTED)
            ->count());
        $this->assertSame(2, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_DECISION_RECORDED)
            ->count());
        Mail::assertSent(Postcard::class, $mails);
    }

    public function test_an_approved_file_cannot_be_flipped_to_denied(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        Decision::record($application, $staff, Status::GRANTED, now()->startOfDay()->setDate(2026, 8, 10));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::DENIED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::GRANTED, $application->fresh()->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
    }

    public function test_the_named_classes_are_told_the_outcome(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $company = null;
        $application = $this->inBackgroundCheck($staff, $company);
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        Assignments::assign($application->fresh(), $officer, $staff);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);
        $application->provider->forceFill([
            'contact_email' => 'notices@galaxy.example',
            'contact_name' => 'Galaxy Notices',
        ])->save();

        Mail::fake();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk();

        $expected = 'AA - GRANTED - 10T1G12661P - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertSent(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->hasTo('ada@example.com')
                && str_contains($mail->payload['lead'], 'granted');
        });
        Mail::assertSent(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertSent(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
        Mail::assertSent(Postcard::class, fn (Postcard $mail) => $mail->hasTo('notices@galaxy.example'));

        // The actor is not bell'd about their own recording; the postcard is
        // how they see it on the audit trail. The other two classes get both.
        $this->assertDatabaseMissing('portal_notifications', [
            'user_id' => $staff->id, 'type' => 'cip.granted',
        ]);
        foreach ([$officer, $contact] as $user) {
            $this->assertDatabaseHas('portal_notifications', [
                'user_id' => $user->id, 'type' => 'cip.granted',
            ]);
        }
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'ada@example.com', 'template' => 'cip-granted',
        ]);
        $this->assertSame(2, Notification::where('type', 'cip.granted')->count());
    }
}
