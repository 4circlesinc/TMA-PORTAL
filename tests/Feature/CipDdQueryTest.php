<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
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
use App\Support\Cip\DdQuery;
use App\Support\Cip\Milestones;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * A due-diligence query: the file passed compliance, the Unit still wants more.
 *
 * Response documents land in DD Query Responses inside Additional Documents.
 * This is not Non-compliant — that status is the compliance query, and mixing
 * the two would send the provider side to the wrong drawer.
 */
class CipDdQueryTest extends TestCase
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
            'submitted_at' => '2026-08-01',
            'accepted_at' => '2026-08-10',
            'locked_at' => now(),
        ])->save();

        return $application->refresh();
    }

    public function test_recording_the_dd_query_date_moves_the_file_to_dd_query(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::DD_QUERY, $body['status']);
        $this->assertSame('DD Query', $body['statusLabel']);
        $this->assertSame('2026-08-18', $body['ddQueryReceivedAt']);
        $this->assertSame(Tree::ADDITIONAL_DD_QUERY, $body['responseFolder']['name'] ?? null);

        $show = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');
        $query = collect($show['milestones'])->firstWhere('key', Milestones::DD_QUERY_RECEIVED);
        $this->assertTrue($query['reached']);
        $this->assertSame('2026-08-18', $query['date']);

        $fresh = $application->fresh();
        $this->assertSame(Status::DD_QUERY, $fresh->status);
        $this->assertSame('2026-08-18', $fresh->dd_query_received_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_DD_QUERY_RECEIVED,
            'actor_id' => $staff->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::BACKGROUND_CHECK,
            'to_status' => Status::DD_QUERY,
        ]);
    }

    public function test_the_provider_side_is_told_to_use_dd_query_responses(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $company = null;
        $application = $this->inBackgroundCheck($staff, $company);

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
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk();

        $expected = 'AA - DD QUERY - 10T1G12661P - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->hasTo('gil@galaxy.example')
                && str_contains($mail->payload['lead'], 'DD Query Responses');
        });

        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'gil@galaxy.example', 'template' => 'cip-dd-query',
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.dd-query',
        ]);

        $drawer = Tree::additionalDrawer($application->fresh(), Tree::ADDITIONAL_DD_QUERY);
        $this->assertNotNull($drawer);

        $path = '/citizenship-applications/'.$application->fresh()->client->uid
            .'?tab=folders&folder='.$drawer->uuid;
        $this->assertSame($path, Notification::query()
            ->where('user_id', $contact->id)
            ->where('type', 'cip.dd-query')
            ->value('action_url'));

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($path) {
            return str_contains((string) data_get($mail->payload, 'button.url'), $path);
        });
    }

    public function test_the_officers_message_rides_along_in_the_notice(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        $application->provider->forceFill([
            'contact_email' => 'notices@galaxy.example',
            'contact_name' => 'Galaxy Notices',
        ])->save();

        $message = 'The Unit wants bank statements covering the last twelve months.';

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
                'message' => $message,
            ])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($message) {
            return $mail->hasTo('notices@galaxy.example')
                && str_contains((string) data_get($mail->payload, 'quote'), $message)
                && str_contains($mail->payload['lead'], 'DD Query Responses');
        });
    }

    public function test_the_officers_message_is_filed_in_the_application_thread(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $message = 'The Unit wants bank statements covering the last twelve months.';

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
                'message' => $message,
            ])
            ->assertOk();

        $this->assertDatabaseHas('cip_application_messages', [
            'application_id' => $application->id,
            'author_id' => $staff->id,
            'lane' => CipApplicationMessage::LANE_PROVIDER,
            'body' => $message,
        ]);
        $this->assertDatabaseMissing('email_deliveries', ['template' => 'cip-message']);
    }

    public function test_the_dd_query_date_is_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('queryReceivedAt');

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        $this->assertNull($application->fresh()->dd_query_received_at);
    }

    public function test_a_compliance_officer_may_record_the_dd_query(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin);
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        Assignments::assign($application->fresh(), $colin, $admin, CipAccess::COMPLIANCE_OFFICER);

        $this->actingAs($colin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::DD_QUERY);
    }

    public function test_the_status_endpoint_is_not_a_way_around_recording_the_date(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::DD_QUERY,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        $this->assertNull($application->fresh()->dd_query_received_at);
    }

    public function test_a_file_still_in_pending_review_cannot_take_a_dd_query(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        $application->forceFill(['status' => Status::PENDING_REVIEW, 'accepted_at' => null])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->dd_query_received_at);
    }

    public function test_an_administrator_may_override_a_dd_query_onto_a_file_off_the_map(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        $application->forceFill(['status' => Status::PENDING_REVIEW])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
                'override' => true,
            ])
            ->assertStatus(422);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
                'override' => true,
                'note' => 'Unit letter arrived before the portal caught up.',
            ])
            ->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::DD_QUERY, $fresh->status);
        $this->assertSame('2026-08-18', $fresh->dd_query_received_at?->toDateString());
    }

    public function test_recording_again_updates_the_date_without_a_second_notice(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $company = null;
        $application = $this->inBackgroundCheck($staff, $company);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact')->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        DdQuery::record($application, $staff, now()->startOfDay()->setDate(2026, 8, 10));
        Mail::assertQueuedCount(2);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.ddQueryReceivedAt', '2026-08-18')
            ->assertJsonPath('application.status', Status::DD_QUERY);

        Mail::assertQueuedCount(2);
        $this->assertSame(2, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_DD_QUERY_RECEIVED)
            ->count());
    }

    public function test_a_dd_query_can_land_from_delayed(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        $application->forceFill(['status' => Status::DELAYED])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::DD_QUERY)
            ->assertJsonPath('application.responseFolder.name', Tree::ADDITIONAL_DD_QUERY);
    }

    public function test_answering_a_dd_query_returns_the_file_to_background_check(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);
        DdQuery::record($application, $staff, now()->startOfDay()->setDate(2026, 8, 18));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::BACKGROUND_CHECK,
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);

        $this->assertSame('2026-08-10', $application->fresh()->accepted_at?->toDateString());
    }

    public function test_the_dd_query_responses_drawer_is_opened(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($staff);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/dd-query', [
                'queryReceivedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $drawer = Tree::additionalDrawer($application->fresh(), Tree::ADDITIONAL_DD_QUERY);
        $this->assertNotNull($drawer);
        $this->assertSame($drawer->uuid, $body['responseFolder']['uuid'] ?? null);
        $this->assertTrue(
            Folder::query()
                ->where('parent_id', Tree::additionalFolder($application->fresh())?->id)
                ->where('name', Tree::ADDITIONAL_DD_QUERY)
                ->exists()
        );
    }
}
