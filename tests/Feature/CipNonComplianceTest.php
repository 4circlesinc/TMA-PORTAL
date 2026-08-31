<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\Notification;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Milestones;
use App\Support\Cip\NonCompliance;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §18 — a Unit query: record the date, move to Non-compliant, tell the firm.
 *
 * Response documents land in Additional Documents, which §17 already leaves
 * writable after the original package is frozen. This file is the inbound
 * half: the date, the status, and the notice.
 */
class CipNonComplianceTest extends TestCase
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

    public function test_recording_the_query_date_moves_the_file_to_non_compliant(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::NON_COMPLIANT, $body['status']);
        $this->assertSame('Non-compliant', $body['statusLabel']);
        $this->assertSame('2026-08-18', $body['queryReceivedAt']);

        $show = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');
        $query = collect($show['milestones'])->firstWhere('key', Milestones::QUERY_RECEIVED);
        $this->assertTrue($query['reached']);
        $this->assertSame('2026-08-18', $query['date']);

        $fresh = $application->fresh();
        $this->assertSame(Status::NON_COMPLIANT, $fresh->status);
        $this->assertSame('2026-08-18', $fresh->query_received_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_QUERY_RECEIVED,
            'actor_id' => $staff->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::PENDING_REVIEW,
            'to_status' => Status::NON_COMPLIANT,
        ]);
    }

    public function test_the_provider_side_is_told_to_use_additional_documents(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $company = null;
        $application = $this->pending($staff, $company);

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
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk();

        $expected = 'AA - NON-COMPLIANT - 10T1G12661P - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->hasTo('gil@galaxy.example')
                && str_contains($mail->payload['lead'], 'Additional Documents');
        });
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('notices@galaxy.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));

        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'gil@galaxy.example', 'template' => 'cip-non-compliant',
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.non-compliant',
        ]);

        $additional = Tree::additionalFolder($application->fresh());
        $this->assertNotNull($additional);
        $queries = Folder::query()
            ->where('parent_id', $additional->id)
            ->where('name', Tree::ADDITIONAL_QUERIES)
            ->first();
        $this->assertNotNull($queries);

        $path = '/citizenship-applications/'.$application->fresh()->client->uid
            .'?tab=folders&folder='.$additional->uuid;
        $this->assertSame($path, Notification::query()
            ->where('user_id', $contact->id)
            ->where('type', 'cip.non-compliant')
            ->value('action_url'));

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($path) {
            return str_contains((string) data_get($mail->payload, 'button.url'), $path);
        });
    }

    public function test_the_query_date_is_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('queryReceivedAt');

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->query_received_at);
    }

    public function test_a_compliance_officer_may_record_the_query(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($admin);
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        Assignments::assign($application->fresh(), $colin, $admin, CipAccess::COMPLIANCE_OFFICER);

        $this->actingAs($colin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::NON_COMPLIANT);
    }

    public function test_an_officer_may_record_the_query(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($admin);
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        Assignments::assign($application->fresh(), $rita, $admin, CipAccess::REVIEWING_OFFICER);

        $this->actingAs($rita)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::NON_COMPLIANT);
    }

    public function test_the_status_endpoint_is_not_a_way_around_recording_the_date(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::NON_COMPLIANT,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->query_received_at);
    }

    public function test_a_file_the_unit_does_not_yet_hold_cannot_take_a_query(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::NEW])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::NEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->query_received_at);
        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_QUERY_RECEIVED)->count());
    }

    public function test_recording_again_updates_the_date_without_a_second_notice(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $company = null;
        $application = $this->pending($staff, $company);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact')->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        NonCompliance::record($application, $staff, now()->startOfDay()->setDate(2026, 8, 10));
        Mail::assertQueuedCount(2);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.queryReceivedAt', '2026-08-18')
            ->assertJsonPath('application.status', Status::NON_COMPLIANT);

        Mail::assertQueuedCount(2);
        $this->assertSame(2, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_QUERY_RECEIVED)
            ->count());
    }

    public function test_a_query_can_land_from_background_check(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::NON_COMPLIANT);
    }

    public function test_a_query_can_land_from_delayed(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::DELAYED])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::NON_COMPLIANT)
            ->assertJsonPath('application.additionalDocumentsFolder', Tree::additionalFolder($application->fresh())?->uuid);
    }
}
