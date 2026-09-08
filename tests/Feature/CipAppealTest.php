<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CompanyMember;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The appeal lane: New appeal → Appeal ready → Appeal submitted → a decision.
 *
 * A decision is not always the end of a file. This covers the three steps,
 * the two dates they record, the Appeal Documents drawer, and the rule that
 * makes that drawer the only way in while the appeal runs.
 */
class CipAppealTest extends TestCase
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

    /** A file the Unit has decided, which is what an appeal needs. */
    private function decided(User $staff, string $status = Status::DENIED): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create([
            'name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id,
            'contact_email' => 'notices@galaxy.example', 'contact_name' => 'Galaxy Notices',
        ]);
        $application = Applications::create($provider, $staff);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        $application->forceFill([
            'status' => $status,
            'cip_number' => '10T1G12661P',
            'submitted_at' => '2026-08-01',
            'decided_at' => '2026-08-20',
            'locked_at' => now(),
        ])->save();

        return $application->refresh();
    }

    private function lodge(User $staff, CipApplication $application, array $body = [])
    {
        return $this->actingAs($staff)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/appeal',
            $body + ['appealLodgedAt' => '2026-08-25'],
        );
    }

    public function test_lodging_an_appeal_records_the_date_and_moves_the_file(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->lodge($staff, $application)
            ->assertOk()
            ->assertJsonPath('application.status', Status::NEW_APPEAL);

        $fresh = $application->fresh();
        $this->assertSame(Status::NEW_APPEAL, $fresh->status);
        $this->assertSame('2026-08-25', $fresh->appeal_lodged_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_APPEAL_LODGED,
        ]);
    }

    public function test_an_approval_can_be_appealed_too(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff, Status::GRANTED);

        // A grant on the wrong terms, or with somebody left off the file, is
        // as appealable as a refusal.
        $this->lodge($staff, $application)->assertOk();
        $this->assertSame(Status::NEW_APPEAL, $application->fresh()->status);
    }

    public function test_a_file_with_no_decision_cannot_be_appealed(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        $application->forceFill(['status' => Status::PENDING_REVIEW])->save();

        $this->lodge($staff, $application->fresh())->assertStatus(422);
        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->appeal_lodged_at);
    }

    public function test_the_lodged_date_is_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('appealLodgedAt');
    }

    public function test_lodging_opens_the_appeal_documents_drawer(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $folderUuid = $this->lodge($staff, $application)->assertOk()->json('appealFolder');

        $appeal = Tree::appealFolder($application->fresh());
        $this->assertNotNull($appeal, 'lodging an appeal must open its drawer');
        $this->assertSame(Tree::APPEAL, $appeal->name);
        $this->assertSame($appeal->uuid, $folderUuid);
    }

    public function test_the_whole_lane_runs_to_a_decision(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->lodge($staff, $application)->assertOk();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-ready', [])
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPEAL_READY);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-submitted', [
                'appealSubmittedAt' => '2026-09-01',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPEAL_SUBMITTED);

        $fresh = $application->fresh();
        $this->assertSame('2026-09-01', $fresh->appeal_submitted_at->toDateString());

        // The outcome is the SAME vocabulary the first decision used: an
        // appeal that succeeds leaves the file Approved, not "appeal won".
        $this->assertContains(
            Status::GRANTED,
            $fresh->fresh()->availableTransitions ?? \App\Support\Cip\Engine::availableTransitions($fresh, $staff),
        );
    }

    public function test_an_appeal_cannot_skip_straight_to_submitted(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->lodge($staff, $application)->assertOk();

        // New appeal → Appeal submitted is not an edge: the provider side has
        // not been asked to confirm yet.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-submitted', [
                'appealSubmittedAt' => '2026-09-01',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::NEW_APPEAL, $application->fresh()->status);
    }

    public function test_the_provider_side_is_told_at_every_step(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->lodge($staff, $application, ['message' => 'The refusal misread the source of funds.'])->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('notices@galaxy.example')
                && str_contains((string) data_get($mail->payload, 'quote'), 'source of funds')
                && str_contains($mail->payload['lead'], 'Appeal Documents');
        });

        // Appeal ready is the one that asks a question rather than reporting
        // a fact, so its letter must actually say so.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-ready', [])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('notices@galaxy.example')
                && str_contains(mb_strtolower($mail->payload['lead'] ?? ''), 'confirm');
        });
    }

    public function test_every_step_files_its_message_in_the_thread(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->lodge($staff, $application, ['message' => 'The refusal misread the source of funds.'])->assertOk();
        $this->actingAs($staff)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/appeal-ready',
            ['message' => 'Counsel opinion is in; please confirm.'],
        )->assertOk();
        $this->actingAs($staff)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/appeal-submitted',
            ['appealSubmittedAt' => '2026-09-01', 'message' => 'Lodged with the Unit this morning.'],
        )->assertOk();

        // The lane's whole conversation reads back in one place, in order.
        $this->assertSame([
            'The refusal misread the source of funds.',
            'Counsel opinion is in; please confirm.',
            'Lodged with the Unit this morning.',
        ], CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->orderBy('id')
            ->pluck('body')
            ->all());

        // Three steps, three status letters, and no thread postcard on top.
        $this->assertDatabaseMissing('email_deliveries', ['template' => 'cip-message']);
    }

    /** A provider contact on the application's own company. */
    private function providerContact(User $staff, CipApplication $application): User
    {
        $contact = User::create([
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'password' => bcrypt('password12345'),
        ]);
        $contact->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::CLIENT,
        ])->save();

        CompanyMember::create([
            'company_id' => $application->provider->company_id,
            'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        return $contact;
    }

    public function test_the_provider_side_can_appeal_their_own_decided_file(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        $contact = $this->providerContact($staff, $application);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-request', [
                'reason' => 'The refusal misread our source of funds letter.',
            ])
            ->assertOk();

        $fresh = $application->fresh();

        // The press lodges it: the file moves, and who started it is kept.
        $this->assertSame(Status::NEW_APPEAL, $fresh->status);
        $this->assertNotNull($fresh->appeal_requested_at);
        $this->assertSame($contact->id, $fresh->appeal_requested_by);
        $this->assertNotNull($fresh->appeal_lodged_at);

        // Their appeal is the same appeal an officer's would be: same drawer.
        $this->assertNotNull(Tree::appealFolder($fresh));

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_APPEAL_REQUESTED,
        ]);

        // Their words reach the firm where the firm reads everything else.
        $this->assertDatabaseHas('cip_application_messages', [
            'application_id' => $application->id,
            'body' => 'The refusal misread our source of funds letter.',
        ]);
    }

    public function test_the_carve_out_is_the_first_step_only(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        $contact = $this->providerContact($staff, $application);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-request', [])
            ->assertOk();

        /*
         * Starting the appeal is theirs. Every step AFTER it is the firm's:
         * the carve-out in Engine::allows names one status, not the lane.
         *
         * Refused, not a particular code: the engine raises an authorization
         * failure and the verb's own precondition can speak first depending
         * on where the file stands. What must hold is that neither call
         * moves it, which is asserted below.
         */
        $ready = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-ready', []);
        $this->assertContains($ready->status(), [403, 422]);

        $submitted = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-submitted', [
                'appealSubmittedAt' => '2026-09-01',
            ]);
        $this->assertContains($submitted->status(), [403, 422]);

        $this->assertSame(Status::NEW_APPEAL, $application->fresh()->status);

        // And the engine itself, which is the rule the endpoints inherit.
        $this->assertFalse(Engine::allows($contact, $application->fresh(), Status::APPEAL_READY));
        $this->assertFalse(Engine::allows($contact, $application->fresh(), Status::APPEAL_SUBMITTED));
    }

    public function test_a_provider_cannot_drive_any_other_status(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff, Status::GRANTED);
        $contact = $this->providerContact($staff, $application);

        // The carve-out must not have opened the lifecycle generally: the
        // ordinary status endpoint is still refused.
        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::POST_APPROVAL,
            ])
            ->assertForbidden();

        $this->assertSame(Status::GRANTED, $application->fresh()->status);
    }

    public function test_a_stranger_cannot_request_an_appeal(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $outsider = User::create([
            'name' => 'Nobody', 'email' => 'nobody@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $outsider->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::CLIENT,
        ])->save();

        // Not 403: being refused would confirm the file exists.
        $this->actingAs($outsider)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-request', [])
            ->assertNotFound();

        $this->assertNull($application->fresh()->appeal_requested_at);
    }

    public function test_pressing_twice_is_the_same_one_appeal(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        $contact = $this->providerContact($staff, $application);

        $url = '/portal/cip/applications/'.$application->uuid.'/appeal-request';
        $this->actingAs($contact)->postJson($url, ['reason' => 'First ask.'])->assertOk();
        $this->actingAs($contact)->postJson($url, ['reason' => 'Second ask.'])->assertOk();

        // A double press is the appeal they already started, not a second
        // one: nobody is told twice and the lane does not restart.
        $this->assertSame(1, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_APPEAL_REQUESTED)
            ->count());
        $this->assertSame('First ask.', $application->fresh()->appeal_request_reason);
        $this->assertSame(Status::NEW_APPEAL, $application->fresh()->status);
    }

    public function test_a_file_with_no_decision_cannot_be_appeal_requested(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        $contact = $this->providerContact($staff, $application);
        $application->forceFill(['status' => Status::PENDING_REVIEW])->save();

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/appeal-request', [])
            ->assertStatus(422);

        $this->assertNull($application->fresh()->appeal_requested_at);
    }

    public function test_the_appeals_tab_lists_exactly_the_files_being_appealed(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $appealed = $this->decided($staff);
        $this->lodge($staff, $appealed)->assertOk();

        // A second file that was decided and left alone: it must not appear.
        $quiet = CipApplication::create([
            'provider_id' => $appealed->provider_id,
            'status' => Status::DENIED,
            'phase' => $appealed->phase,
            'created_by' => $staff->id,
        ]);

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase=appeal')
            ->assertOk()
            ->json();

        $ids = array_column($body['applications'], 'id');
        $this->assertContains($appealed->uuid, $ids);
        $this->assertNotContains($quiet->uuid, $ids);

        // The tab's own badge, counted the same way the filter selects.
        $this->assertSame(1, $body['phaseCounts']['appeal'] ?? null);
    }

    public function test_the_appeal_tab_is_not_a_phase(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff, Status::GRANTED);
        $phase = $application->phase;

        $this->lodge($staff, $application)->assertOk();

        // Appealing does not move the file between lanes: it is still whatever
        // phase it was, standing on an appeal status. The tab is a status
        // filter, the way Closed is.
        $this->assertSame($phase, $application->fresh()->phase);
    }

    public function test_appeal_documents_is_the_only_drawer_open_during_an_appeal(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        Tree::provisionAdditionalDrawers($application, $staff);

        $this->lodge($staff, $application)->assertOk();
        $fresh = $application->fresh();

        $appeal = Tree::appealFolder($fresh);
        $additional = Tree::additionalFolder($fresh);
        $root = Folder::find($fresh->folder_id);

        $this->assertTrue(
            FileAccess::canUploadTo($staff, $appeal),
            'the appeal drawer must take uploads',
        );
        $this->assertFalse(
            FileAccess::canUploadTo($staff, $additional),
            'Additional Documents answers the FIRST decision, not the appeal',
        );
        $this->assertFalse(
            FileAccess::canUploadTo($staff, $root),
            'the application root must not take appeal paper either',
        );
    }

    public function test_a_subfolder_of_the_appeal_drawer_still_takes_uploads(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        $this->lodge($staff, $application)->assertOk();

        $appeal = Tree::appealFolder($application->fresh());
        $nested = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Counsel opinion',
            'parent_id' => $appeal->id,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        // The rule is about the drawer, not one folder: an appeal bundle is
        // allowed to have structure inside it.
        $this->assertTrue(FileAccess::canUploadTo($staff, $nested));
    }

    public function test_the_drawer_rule_lifts_once_the_appeal_is_decided(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);
        Tree::provisionAdditionalDrawers($application, $staff);
        $this->lodge($staff, $application)->assertOk();

        $additional = Tree::additionalFolder($application->fresh());
        $this->assertFalse(FileAccess::canUploadTo($staff, $additional));

        // Out of the lane, the rule has nothing to say and the ordinary
        // permissions decide again.
        $application->fresh()->forceFill(['status' => Status::DENIED])->save();
        $this->assertTrue(FileAccess::canUploadTo($staff, $additional));
    }

    public function test_recording_the_appeal_again_updates_the_date(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->decided($staff);

        $this->lodge($staff, $application)->assertOk();
        $first = count(Mail::queued(Postcard::class));

        $this->lodge($staff, $application->fresh(), ['appealLodgedAt' => '2026-08-28'])->assertOk();

        // A correction, not a second appeal: the date moves and nobody is
        // told twice about the same episode.
        $this->assertSame('2026-08-28', $application->fresh()->appeal_lodged_at->toDateString());
        $this->assertSame($first, count(Mail::queued(Postcard::class)));
    }
}
