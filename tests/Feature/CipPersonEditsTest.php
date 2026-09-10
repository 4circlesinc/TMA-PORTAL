<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipPersonChangeRequest;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Correcting a person on a post-approval file.
 *
 * Confirm submission freezes the package the Unit was handed, and it was also
 * freezing every name and date on the file — so a misspelling could not be
 * fixed anywhere in the portal once a decision landed. Details are editable
 * again after the decision; the scans stay frozen.
 *
 * An administrator's edit lands. Everyone else proposes, and an administrator
 * decides.
 */
class CipPersonEditsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Mail::fake();
    }

    private function user(string $type, string $email): User
    {
        $user = User::create(['name' => ucfirst(explode('@', $email)[0]), 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    /** @return array{0: CipApplication, 1: CipPerson, 2: User} */
    private function postApprovalFile(): array
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $admin->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $admin);

        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Ana', 'last_name' => 'Silva',
        ]);

        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'status' => Status::POST_APPROVAL,
            'cip_number' => '10T1G12661P',
            'locked_at' => now(),
        ])->save();

        return [$application->fresh(), $person, $admin];
    }

    private function contact(CipApplication $application, User $admin): User
    {
        $user = $this->user(Role::CLIENT, 'gil@galaxy.example');
        CompanyMember::create([
            'company_id' => $application->provider->company_id,
            'user_id' => $user->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $admin->id,
        ]);

        return $user;
    }

    public function test_an_administrators_correction_lands_on_the_record(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Anna',
            ])
            ->assertOk()
            // Null means applied; the screen says "saved" rather than "requested".
            ->assertJsonPath('requested', null);

        $this->assertSame('ANNA', $person->fresh()->first_name);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_PERSON_CHANGED,
        ]);
    }

    public function test_the_provider_side_proposes_and_the_value_does_not_move(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();
        $contact = $this->contact($application, $admin);

        $body = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Anna',
                'note' => 'The passport spells it Anna.',
            ])
            ->assertOk()
            ->json();

        // The whole point: it is recorded, and nothing has changed yet.
        $this->assertNotNull($body['requested']);
        $this->assertSame('ANA', $person->fresh()->first_name);
        $this->assertCount(1, $body['pendingChanges']);
        $this->assertSame(
            ['from' => 'ANA', 'to' => 'ANNA'],
            $body['pendingChanges'][0]['changes']['firstName'],
        );
    }

    public function test_an_administrator_approving_applies_it(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();
        $contact = $this->contact($application, $admin);

        $requested = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Anna',
            ])
            ->json('requested');

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/change-requests/'.$requested, [
                'approve' => true,
            ])
            ->assertOk()
            ->assertJsonPath('pendingChanges', []);

        $this->assertSame('ANNA', $person->fresh()->first_name);
    }

    public function test_declining_leaves_the_record_alone(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();
        $contact = $this->contact($application, $admin);

        $requested = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Wrong',
            ])
            ->json('requested');

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/change-requests/'.$requested, [
                'approve' => false, 'note' => 'The passport says Ana.',
            ])
            ->assertOk();

        $this->assertSame('ANA', $person->fresh()->first_name);
        $this->assertSame(
            CipPersonChangeRequest::STATUS_DECLINED,
            CipPersonChangeRequest::where('uuid', $requested)->value('status'),
        );
    }

    public function test_only_an_administrator_may_answer_a_request(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();
        $contact = $this->contact($application, $admin);

        $requested = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Anna',
            ])
            ->json('requested');

        // Approving your own request would make the approval meaningless.
        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/change-requests/'.$requested, [
                'approve' => true,
            ])
            ->assertForbidden();

        $this->assertSame('ANA', $person->fresh()->first_name);
    }

    public function test_a_second_proposal_replaces_the_first(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();
        $contact = $this->contact($application, $admin);

        $url = '/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details';
        $this->actingAs($contact)->postJson($url, ['firstName' => 'Anna'])->assertOk();
        $body = $this->actingAs($contact)->postJson($url, ['firstName' => 'Annabel'])->assertOk()->json();

        // One open ask per person: an approver reading two half-corrections
        // would have to reconcile them by hand.
        $this->assertCount(1, $body['pendingChanges']);
        $this->assertSame('ANNABEL', $body['pendingChanges'][0]['changes']['firstName']['to']);
    }

    /**
     * Who somebody is can be corrected in either lane.
     *
     * It used to be post-approval only, on the reasoning that the intake form
     * already owned these fields before the decision. That form is the reason
     * this exists: it let anyone holding cip.create rewrite the identity on a
     * filing nobody had reviewed. An administrator writes it; everyone else
     * asks, on both sides of the decision.
     */
    public function test_details_are_editable_before_the_decision_too(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();
        $application->forceFill(['phase' => Phase::PRE_APPROVAL, 'status' => Status::PENDING_REVIEW])->save();

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Anna',
            ])
            ->assertOk();

        $this->assertSame('ANNA', $person->fresh()->first_name);
    }

    public function test_a_stranger_cannot_reach_the_person(): void
    {
        [$application, $person] = $this->postApprovalFile();
        $outsider = $this->user(Role::CLIENT, 'nobody@example.com');

        // 404, not 403: a refusal would confirm the file exists.
        $this->actingAs($outsider)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Anna',
            ])
            ->assertNotFound();
    }

    public function test_sending_a_field_back_unchanged_is_not_a_correction(): void
    {
        [$application, $person, $admin] = $this->postApprovalFile();

        // The form posts every field, so most of them arrive identical. An
        // approver should never be shown "Ana -> Ana" as a proposed change.
        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/people/'.$person->uuid.'/details', [
                'firstName' => 'Ana', 'lastName' => 'Silva',
            ])
            ->assertStatus(422);
    }
}
