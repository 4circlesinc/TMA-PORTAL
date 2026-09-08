<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
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
