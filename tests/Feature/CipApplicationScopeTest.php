<?php

namespace Tests\Feature;

use App\Models\CipApplicationAssignment;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Tree;
use App\Support\Files\FileAccess;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Row scoping: provider contacts see their firm's applications and nothing
 * else, private clients see their own record's, officers and admins see all,
 * and a plain employee sees none. Lookups outside the slice fail as 404
 * (ModelNotFoundException), never 403 — existence must not leak.
 */
class CipApplicationScopeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** A provider firm with one active contact who can sign in. */
    private function providerWithContact(string $code): array
    {
        $company = Company::create(['uid' => strtolower($code).'-firm', 'name' => $code.' Firm']);
        $contact = $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $provider = CipProvider::create([
            'name' => $code.' Provider', 'code' => $code, 'company_id' => $company->id,
        ]);

        return [$provider, $contact];
    }

    public function test_provider_contacts_see_only_their_firms_applications(): void
    {
        $staff = $this->user(Role::EMPLOYEE);
        [$galaxy, $galaxyContact] = $this->providerWithContact('GAL');
        [$bluemina, $blueminaContact] = $this->providerWithContact('BLU');

        $galaxyApp = Applications::create($galaxy, $staff);
        $blueminaApp = Applications::create($bluemina, $staff);

        $this->assertSame(
            [$galaxyApp->id],
            ApplicationScope::query($galaxyContact)->pluck('id')->all(),
        );

        // The other firm's application resolves as "does not exist".
        $this->expectException(ModelNotFoundException::class);
        ApplicationScope::findOrFail($galaxyContact, $blueminaApp->uuid);
    }

    public function test_private_clients_see_their_own_applications(): void
    {
        $staff = $this->user(Role::EMPLOYEE);
        [$private] = $this->providerWithContact('PRI');

        $account = $this->user(Role::CLIENT);
        $client = Client::create(['uid' => 'asem-habtoor', 'name' => 'Asem Habtoor', 'user_id' => $account->id, 'created_by' => $staff->id, 'data' => []]);

        $own = Applications::create($private, $staff, ['client_id' => $client->id]);
        Applications::create($private, $staff); // someone else's PRI file

        $this->assertSame(
            [$own->id],
            ApplicationScope::query($account)->pluck('id')->all(),
        );
    }

    public function test_an_officer_sees_the_whole_book_even_without_an_assignment(): void
    {
        $staff = $this->user(Role::EMPLOYEE);
        [$galaxy] = $this->providerWithContact('GAL');
        $held = Applications::create($galaxy, $staff);
        $open = Applications::create($galaxy, $staff); // unassigned — still on the caseload

        $admin = $this->user(Role::ADMINISTRATOR);
        $this->assertCount(2, ApplicationScope::query($admin)->get(), 'the administrator reads the book');

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $this->assertEqualsCanonicalizing(
            [$held->id, $open->id],
            ApplicationScope::query($officer)->pluck('id')->all(),
            'assignment names who is working it, it does not hide the rest',
        );

        $filed = Applications::create($galaxy, $officer);
        $this->assertEqualsCanonicalizing(
            [$held->id, $open->id, $filed->id],
            ApplicationScope::query($officer)->pluck('id')->all(),
            'filing is on the same book',
        );

        CipApplicationAssignment::create([
            'application_id' => $held->id,
            'user_id' => $officer->id,
            'role' => 'reviewing_officer',
            'status' => CipApplicationAssignment::STATUS_ACTIVE,
            'assigned_by' => $officer->id,
            'starts_at' => now(),
        ]);

        $this->assertEqualsCanonicalizing(
            [$held->id, $open->id, $filed->id],
            ApplicationScope::query($officer)->pluck('id')->all(),
            'holding a file does not shrink the book',
        );

        // A parked Employee reaches no portal route and no slice either.
        $this->assertCount(0, ApplicationScope::query($staff)->get());
    }

    public function test_an_officer_can_open_a_colleague_s_filing_and_its_documents(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        [$galaxy] = $this->providerWithContact('GAL');
        $application = Applications::create($galaxy, $admin);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        Tree::provision($application->fresh(['people', 'provider']), $admin);
        $application = $application->fresh(['client']);
        $root = Folder::find($application->client->folder_id);

        $officer = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($officer)
            ->getJson('/portal/cip/applications')
            ->assertOk()
            ->assertJsonPath('total', 1);

        $this->actingAs($officer)
            ->getJson('/portal/clients/'.$application->client->uid)
            ->assertOk()
            ->assertJsonPath('client.id', $application->client->uid);

        $this->assertSame('downloader', FileAccess::folderRole($officer, $root));
        $this->actingAs($officer)
            ->getJson('/portal/files/?section=all&folder='.$root->uuid)
            ->assertOk();
    }

    public function test_the_dark_module_shows_nobody_anything(): void
    {
        $staff = $this->user(Role::EMPLOYEE);
        [$galaxy] = $this->providerWithContact('GAL');
        Applications::create($galaxy, $staff);

        config(['services.cip.enabled' => false]);

        $admin = $this->user(Role::ADMINISTRATOR);
        $this->assertCount(0, ApplicationScope::query($admin)->get());
    }
}
