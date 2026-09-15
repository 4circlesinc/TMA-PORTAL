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
use App\Support\Cip\FolderAccess;
use App\Support\Cip\Phase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Handing a filed CIP application to another service provider must move the
 * client folder with it, or the outgoing firm keeps opening papers that
 * ApplicationScope has already taken away.
 */
class CipProviderTransferTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email = 'someone@example.com'): User
    {
        $user = User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ])->save();

        return $user;
    }

    /** @return array{0: CipProvider, 1: Company, 2: User, 3: Folder} */
    private function firm(string $code, string $name, User $owner): array
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $name,
        ]);
        $contact = $this->user(Role::CLIENT, strtolower($code).'@firm.test');
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $library = Folder::query()
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->whereRaw('LOWER(name) = ?', ['citizenship applications'])
            ->first();

        if (! $library) {
            $library = Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => 'Citizenship Applications',
                'folder_type' => Folder::TYPE_ORGANIZATION,
                'owner_id' => $owner->id,
                'created_by' => $owner->id,
            ]);
        }

        $firmFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'parent_id' => $library->id,
            'folder_type' => Folder::TYPE_USER,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        $provider = CipProvider::create([
            'name' => $name,
            'code' => $code,
            'company_id' => $company->id,
            'folder_id' => $firmFolder->id,
            'active' => true,
        ]);

        return [$provider, $company, $contact, $firmFolder];
    }

    /** @return array{0: CipApplication, 1: Client, 2: Folder} */
    private function filed(User $admin, CipProvider $provider, Folder $firmFolder): array
    {
        $client = Client::create([
            'uid' => 'chen-wei-'.Str::random(4),
            'name' => 'Chen Wei',
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $provider->company_id,
            'company_id' => $provider->company_id,
            'company' => $provider->name,
            'created_by' => $admin->id,
            'data' => [],
        ]);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Chen Wei',
            'parent_id' => $firmFolder->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);
        $client->forceFill(['folder_id' => $folder->id])->save();

        $application = Applications::create($provider, $admin, [
            'client_id' => $client->id,
        ]);
        $application->forceFill(['folder_id' => $folder->id])->save();
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        return [$application->fresh(['provider', 'client']), $client->fresh(), $folder->fresh()];
    }

    public function test_admin_transfer_moves_folder_and_cuts_outgoing_firm_access(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , $galaxyContact, $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, $igaCompany, $igaContact, $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, $client, $folder] = $this->filed($admin, $galaxy, $galaxyFolder);

        FolderAccess::forget();
        $this->assertContains((int) $client->id, FolderAccess::clientIdsFor($galaxyContact));
        $this->assertNotContains((int) $client->id, FolderAccess::clientIdsFor($igaContact));

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJsonPath('application.providerId', $igraphix->uuid)
            ->assertJsonPath('application.provider', 'iGraphix');

        $application->refresh();
        $client->refresh();
        $folder->refresh();

        $this->assertSame($igraphix->id, $application->provider_id);
        $this->assertSame($igaCompany->id, $client->referred_by_company_id);
        $this->assertSame($igaFolder->id, $folder->parent_id);
        $this->assertSame($galaxyFolder->id !== $folder->parent_id, true);

        FolderAccess::forget();
        $this->assertNotContains((int) $client->id, FolderAccess::clientIdsFor($galaxyContact));
        $this->assertContains((int) $client->id, FolderAccess::clientIdsFor($igaContact));

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_PROVIDER_TRANSFERRED,
            'actor_id' => $admin->id,
        ]);
    }

    public function test_transfer_requires_explicit_confirmation(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['confirm']);

        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
    }

    public function test_officer_cannot_transfer_provider(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertForbidden();

        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
    }

    public function test_add_on_family_moves_together(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, , , $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$parent, , $parentFolder] = $this->filed($admin, $galaxy, $galaxyFolder);

        $addonClient = Client::create([
            'uid' => 'mei-wei-'.Str::random(4),
            'name' => 'Mei Wei',
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $galaxy->company_id,
            'created_by' => $admin->id,
            'data' => [],
        ]);
        $addonFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Mei Wei',
            'parent_id' => $galaxyFolder->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $addonClient->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);
        $addonClient->forceFill(['folder_id' => $addonFolder->id])->save();

        $addon = Applications::create($galaxy, $admin, [
            'client_id' => $addonClient->id,
        ]);
        $addon->forceFill([
            'folder_id' => $addonFolder->id,
            'phase' => Phase::ADD_ON,
            'parent_application_id' => $parent->id,
        ])->save();
        CipPerson::create([
            'application_id' => $addon->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Mei',
            'last_name' => 'Wei',
            'relationship' => 'Spouse',
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$addon->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJsonCount(2, 'moved');

        $this->assertSame($igraphix->id, $parent->fresh()->provider_id);
        $this->assertSame($igraphix->id, $addon->fresh()->provider_id);
        $this->assertSame($igaFolder->id, $parentFolder->fresh()->parent_id);
        $this->assertSame($igaFolder->id, $addonFolder->fresh()->parent_id);
    }

    public function test_name_collision_under_destination_is_renamed_not_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, , , $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, , $folder] = $this->filed($admin, $galaxy, $galaxyFolder);

        Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Chen Wei',
            'parent_id' => $igaFolder->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertOk();

        $folder->refresh();
        $this->assertSame($igaFolder->id, $folder->parent_id);
        $this->assertNotSame('Chen Wei', $folder->name);
        $this->assertStringStartsWith('Chen Wei', $folder->name);
    }
}
