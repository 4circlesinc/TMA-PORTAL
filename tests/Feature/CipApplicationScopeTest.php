<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Applications;
use App\Support\Cip\CipAccess;
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

    public function test_officers_and_admins_see_everything_and_plain_employees_see_nothing(): void
    {
        $staff = $this->user(Role::EMPLOYEE);
        [$galaxy] = $this->providerWithContact('GAL');
        Applications::create($galaxy, $staff);

        $admin = $this->user(Role::ADMINISTRATOR);
        $this->assertCount(1, ApplicationScope::query($admin)->get());

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $this->assertCount(1, ApplicationScope::query($officer)->get());

        // An employee with no officer grant sees nothing — widening that is a
        // deliberate decision, not a default.
        $this->assertCount(0, ApplicationScope::query($staff)->get());
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
