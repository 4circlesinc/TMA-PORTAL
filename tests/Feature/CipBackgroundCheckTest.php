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
use App\Support\Cip\BackgroundCheck;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Milestones;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §19 — accepted for processing: record the date, move to Background check.
 *
 * The delay clock (§20) measures from this date, so the dedicated verb exists
 * to make sure `accepted_at` is never left empty by a bare status change.
 */
class CipBackgroundCheckTest extends TestCase
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

    private function pending(User $staff, ?Company &$company = null): CipApplication
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
            'status' => Status::PENDING_REVIEW,
            'cip_number' => '10T1G12661P',
            'submitted_at' => '2026-08-01',
            'locked_at' => now(),
        ])->save();

        return $application->refresh();
    }

    public function test_recording_the_accepted_date_moves_the_file_to_background_check(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::BACKGROUND_CHECK, $body['status']);
        $this->assertSame('Background Check', $body['statusLabel']);
        $this->assertSame('2026-08-18', $body['acceptedAt']);

        $show = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');
        $accepted = collect($show['milestones'])->firstWhere('key', Milestones::ACCEPTED);
        $this->assertTrue($accepted['reached']);
        $this->assertSame('2026-08-18', $accepted['date']);

        $fresh = $application->fresh();
        $this->assertSame(Status::BACKGROUND_CHECK, $fresh->status);
        $this->assertSame('2026-08-18', $fresh->accepted_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_ACCEPTED_FOR_PROCESSING,
            'actor_id' => $staff->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::PENDING_REVIEW,
            'to_status' => Status::BACKGROUND_CHECK,
        ]);
    }

    public function test_the_provider_side_is_told_a_background_check_is_underway(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $company = null;
        $application = $this->pending($staff, $company);
        Tree::provision($application->fresh(), $staff);

        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
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

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk();

        $expected = 'AA - BACKGROUND CHECK - 10T1G12661P - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            $details = collect($mail->payload['details'] ?? []);

            return $mail->subjectLine === $expected
                && $mail->hasTo('gil@galaxy.example')
                && str_contains((string) ($mail->payload['bodyHtml'] ?? ''), 'background check')
                && $details->contains(fn ($row) => ($row[0] ?? null) === 'Accepted for processing' && ($row[1] ?? null) === '2026-08-18');
        });
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('notices@galaxy.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));

        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'gil@galaxy.example', 'template' => 'cip-status-background-check',
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.background-check',
        ]);

        $path = '/citizenship-applications/'.$application->fresh()->client->uid.'?tab=folders';
        $this->assertSame($path, Notification::query()
            ->where('user_id', $contact->id)
            ->where('type', 'cip.background-check')
            ->value('action_url'));

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($path) {
            return str_contains((string) data_get($mail->payload, 'button.url'), $path);
        });
    }

    public function test_updating_the_accepted_date_does_not_send_another_notice(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        BackgroundCheck::record($application, $staff, now()->startOfDay()->setDate(2026, 8, 10));
        Mail::assertQueued(Postcard::class);
        $first = count(Mail::queued(Postcard::class));

        BackgroundCheck::record($application->fresh(), $staff, now()->startOfDay()->setDate(2026, 8, 18));
        $this->assertSame($first, count(Mail::queued(Postcard::class)));
    }

    public function test_the_accepted_date_is_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('acceptedAt');

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->accepted_at);
    }

    public function test_a_compliance_officer_may_record_acceptance(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($admin);
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        Assignments::assign($application->fresh(), $colin, $admin, CipAccess::COMPLIANCE_OFFICER);

        $this->actingAs($colin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);
    }

    public function test_an_officer_may_record_acceptance(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($admin);
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        Assignments::assign($application->fresh(), $rita, $admin, CipAccess::REVIEWING_OFFICER);

        $this->actingAs($rita)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);
    }

    public function test_the_status_endpoint_is_not_a_way_around_recording_the_date(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::BACKGROUND_CHECK,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->accepted_at);
    }

    public function test_a_file_the_unit_does_not_yet_hold_cannot_be_accepted(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::NEW])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::NEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->accepted_at);
        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_ACCEPTED_FOR_PROCESSING)->count());
    }

    public function test_recording_again_updates_the_date_without_a_second_move(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        BackgroundCheck::record($application, $staff, now()->startOfDay()->setDate(2026, 8, 10));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.acceptedAt', '2026-08-18')
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);

        $this->assertSame(1, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::BACKGROUND_CHECK)
            ->count());
        $this->assertSame(2, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_ACCEPTED_FOR_PROCESSING)
            ->count());
    }

    public function test_acceptance_can_land_from_non_compliant(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::NON_COMPLIANT])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);
    }
}
