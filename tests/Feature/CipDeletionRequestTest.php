<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * A filed application is deleted by an administrator; everyone else asks.
 *
 * Drafts are their creator's to delete and are never asked about. Once
 * filed, staff and the provider side request deletion with a reason, the
 * requester may take it back, and an administrator either deletes the file
 * (the yes) or declines.
 */
class CipDeletionRequestTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email): User
    {
        return User::factory()->create([
            'name' => ucfirst(strtok($email, '@')),
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function provider(User $owner): CipProvider
    {
        $company = Company::create(['uid' => 'gal-firm', 'name' => 'GAL Firm', 'created_by' => $owner->id]);

        return CipProvider::create(['name' => 'GAL Firm', 'code' => 'GAL', 'company_id' => $company->id]);
    }

    private function filing(User $staff, CipProvider $provider): CipApplication
    {
        $application = Applications::create($provider, $staff, ['investment_type' => 'real_estate']);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        Tree::provision($application->fresh(['people', 'provider']), $staff);

        return $application->fresh();
    }

    private function contactOf(CipProvider $provider): User
    {
        $contact = $this->user(Role::CLIENT, 'galaxy@example.com');
        CompanyMember::create([
            'company_id' => $provider->company_id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        return $contact;
    }

    private function ask(User $user, CipApplication $application, ?string $reason = 'Filed twice by mistake.')
    {
        return $this->actingAs($user)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/deletion-request',
            $reason === null ? [] : ['reason' => $reason],
        );
    }

    public function test_an_officer_asks_instead_of_deleting_a_filed_application(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        $application = $this->filing($admin, $this->provider($admin));

        $this->actingAs($officer)
            ->deleteJson('/portal/cip/applications/'.$application->uuid)
            ->assertNotFound();
        $this->assertNotNull(CipApplication::query()->find($application->id), 'An officer cannot delete it.');

        $this->ask($officer, $application)->assertOk();

        $application->refresh();
        $this->assertNotNull($application->deletion_requested_at);
        $this->assertSame($officer->id, (int) $application->deletion_requested_by);
        $this->assertSame('Filed twice by mistake.', $application->deletion_request_reason);
        $this->assertTrue(CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_DELETION_REQUESTED)->exists());
        Mail::assertQueued(Postcard::class, fn (Postcard $m) => $m->hasTo('admin@example.com'));

        $row = $this->actingAs($officer)->getJson('/portal/cip/applications')->assertOk()->json('applications.0');
        $this->assertFalse($row['canDelete']);
        $this->assertTrue($row['canRequestDeletion']);
        $this->assertSame('Filed twice by mistake.', $row['deletionRequest']['reason']);
        $this->assertTrue($row['deletionRequest']['mine']);

        $adminRow = $this->actingAs($admin)->getJson('/portal/cip/applications')->json('applications.0');
        $this->assertTrue($adminRow['canDelete']);
        $this->assertFalse($adminRow['canRequestDeletion']);
        $this->assertFalse($adminRow['deletionRequest']['mine']);
    }

    public function test_a_reason_is_required(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        $application = $this->filing($admin, $this->provider($admin));

        $this->ask($officer, $application, null)->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->assertNull($application->fresh()->deletion_requested_at);
    }

    public function test_a_provider_contact_may_ask_but_not_delete(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $provider = $this->provider($admin);
        $application = $this->filing($admin, $provider);
        $contact = $this->contactOf($provider);

        $this->actingAs($contact)
            ->deleteJson('/portal/cip/applications/'.$application->uuid)
            ->assertNotFound();
        $this->ask($contact, $application)->assertOk();
        $this->assertSame($contact->id, (int) $application->fresh()->deletion_requested_by);
    }

    public function test_an_administrator_deletes_rather_than_asks_and_a_draft_is_never_asked_about(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        $provider = $this->provider($admin);
        $application = $this->filing($admin, $provider);

        $this->ask($admin, $application)->assertForbidden();

        $draft = $this->filing($officer, $provider);
        $draft->forceFill(['status' => Status::DRAFT])->save();
        $this->ask($officer, $draft)->assertForbidden();
    }

    public function test_the_requester_withdraws_and_only_an_administrator_declines(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        $colleague = $this->user(Role::REVIEWING_OFFICER, 'cro2@example.com');
        $application = $this->filing($admin, $this->provider($admin));
        $url = '/portal/cip/applications/'.$application->uuid.'/deletion-request';

        $this->ask($officer, $application)->assertOk();
        $this->actingAs($colleague)->deleteJson($url)->assertForbidden();
        $this->assertNotNull($application->fresh()->deletion_requested_at, 'A colleague cannot clear it.');

        $this->actingAs($officer)->deleteJson($url)->assertOk();
        $this->assertNull($application->fresh()->deletion_requested_at, 'The requester took it back.');
        $this->assertTrue(CipEvent::query()->where('action', CipEvent::ACTION_DELETION_WITHDRAWN)->exists());

        $this->ask($officer, $application)->assertOk();
        $this->actingAs($admin)->deleteJson($url, ['note' => 'We still need this file.'])->assertOk();
        $this->assertNull($application->fresh()->deletion_requested_at, 'Declined.');
        $this->assertNotNull(CipApplication::query()->find($application->id), 'Declining keeps the file.');
        $this->assertTrue(CipEvent::query()->where('action', CipEvent::ACTION_DELETION_DECLINED)->exists());
        Mail::assertQueued(Postcard::class, fn (Postcard $m) => $m->hasTo('cro@example.com'));
    }

    public function test_an_administrator_approves_by_deleting_and_the_requester_is_told(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        $application = $this->filing($admin, $this->provider($admin));

        $this->ask($officer, $application)->assertOk();
        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/delete')
            ->assertOk();

        $this->assertNull(CipApplication::query()->find($application->id));
        Mail::assertQueued(Postcard::class, fn (Postcard $m) => $m->hasTo('cro@example.com')
            && str_contains((string) $m->subjectLine, 'deletion approved'));
    }
}
