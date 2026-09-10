<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Deleting an application removes the filing, not the person.
 *
 * The table's Delete used to post the client bulk-delete endpoint, so the
 * row the reader clicked stayed on the caseload. This is the verb that
 * actually takes the application off it.
 */
class CipApplicationDeleteTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email = 'ada@example.com'): User
    {
        return User::factory()->create([
            'name' => 'Ada Admin',
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function provider(User $owner, string $code = 'GAL'): CipProvider
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $code.' Firm',
            'created_by' => $owner->id,
        ]);

        return CipProvider::create([
            'name' => $code.' Firm',
            'code' => $code,
            'company_id' => $company->id,
        ]);
    }

    /** A numbered application with a client, a family, and a folder tree. */
    private function filing(User $staff, CipProvider $provider): CipApplication
    {
        $application = Applications::create($provider, $staff, [
            'investment_type' => 'real_estate',
        ]);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        Tree::provision($application->fresh(['people', 'provider']), $staff);

        return $application->fresh(['people', 'client']);
    }

    public function test_deleting_an_application_leaves_the_client(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->filing($staff, $this->provider($staff));
        $clientId = $application->client_id;
        $clientFolderId = $application->client->folder_id;
        $personFolderId = $application->people->first()->folder_id;

        $this->assertNotNull($clientId);
        $this->assertNotNull($clientFolderId);
        $this->assertNotNull($personFolderId);
        $this->assertNotSame($clientFolderId, $personFolderId);

        $this->actingAs($staff)
            ->deleteJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk();

        $this->assertNull(CipApplication::query()->find($application->id));
        $this->assertNotNull(
            CipApplication::withTrashed()->find($application->id),
            'A numbered file is recoverable, not destroyed.',
        );

        $this->assertNotNull(Client::query()->find($clientId), 'The person is not the application.');
        $this->assertNotNull(Folder::query()->find($clientFolderId), 'The client folder stays in the library.');
        $this->assertNull(Folder::query()->find($personFolderId));
        $this->assertNotNull(
            Folder::withTrashed()->find($personFolderId),
            'The application paper is in the recycle bin.',
        );

        $this->assertSame(
            CipEvent::ACTION_DELETED,
            CipEvent::query()->where('application_id', $application->id)->latest('id')->value('action'),
        );

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications')
            ->assertOk()
            ->assertJsonCount(0, 'applications');
    }

    public function test_the_table_row_says_whether_this_reader_may_delete(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $this->filing($staff, $this->provider($staff));

        $row = $this->actingAs($staff)
            ->getJson('/portal/cip/applications')
            ->assertOk()
            ->json('applications.0');

        $this->assertTrue($row['canDelete']);
    }

    public function test_a_provider_contact_cannot_delete_a_filed_application(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider($staff);
        $application = $this->filing($staff, $provider);

        $contact = $this->user(Role::CLIENT, 'galaxy@example.com');
        CompanyMember::create([
            'company_id' => $provider->company_id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $this->actingAs($contact)
            ->deleteJson('/portal/cip/applications/'.$application->uuid)
            ->assertNotFound();

        $this->assertNotNull(CipApplication::query()->find($application->id));
    }

    public function test_an_officer_who_does_not_hold_the_file_cannot_delete_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        $application = $this->filing($admin, $this->provider($admin));

        $this->actingAs($officer)
            ->deleteJson('/portal/cip/applications/'.$application->uuid)
            ->assertNotFound();

        $this->assertNotNull(CipApplication::query()->find($application->id));
    }

    public function test_deleting_a_draft_from_the_table_removes_it_outright(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider($staff);

        $this->actingAs($staff)->postJson('/portal/cip/applications/draft', [
            'providerId' => $provider->uuid,
            'phase' => Phase::PRE_APPROVAL,
            'firstName' => 'Amara',
            'lastName' => 'Diallo',
            'passportPhoto' => UploadedFile::fake()->image('face.jpg', 600, 600),
        ])->assertOk();

        $draft = CipApplication::query()->first();
        $this->assertSame(Status::DRAFT, $draft->status);

        $this->actingAs($staff)
            ->deleteJson('/portal/cip/applications/'.$draft->uuid)
            ->assertOk();

        $this->assertNull(CipApplication::withTrashed()->find($draft->id));
    }
}
