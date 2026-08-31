<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Citizenship Applications library's top-level folders ARE the service
 * providers: the command mirrors them into cip_providers, linked, with
 * generated codes, and can be rerun without inventing duplicates.
 */
class CipProvidersFromFoldersTest extends TestCase
{
    use RefreshDatabase;

    private function library(array $children): Folder
    {
        $owner = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $root = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Citizenship Applications',
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'audience' => 'all_staff',
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        foreach ($children as $name) {
            Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => $name,
                'parent_id' => $root->id,
                'owner_id' => $owner->id,
                'created_by' => $owner->id,
            ]);
        }

        return $root;
    }

    public function test_provider_folders_become_linked_providers_with_codes(): void
    {
        $this->library(['GALAXY', 'GLOBAL CITIZEN SOLUTIONS', 'PRIVATE', 'J LAW']);

        $this->artisan('cip:providers-from-folders')->assertSuccessful();

        $galaxy = CipProvider::where('name', 'GALAXY')->firstOrFail();
        $this->assertSame('GAL', $galaxy->code);
        $this->assertSame('GALAXY', $galaxy->folder->name);

        $this->assertSame('GLO', CipProvider::where('name', 'GLOBAL CITIZEN SOLUTIONS')->value('code'));
        $this->assertSame('JLA', CipProvider::where('name', 'J LAW')->value('code'));

        // The private-clients folder claims the reserved bucket code.
        $this->assertSame('PRI', CipProvider::where('name', 'PRIVATE')->value('code'));
    }

    public function test_the_command_is_idempotent_and_codes_never_collide(): void
    {
        $this->library(['REACH WORLD', 'REAL 21']);

        $this->artisan('cip:providers-from-folders')->assertSuccessful();
        $this->artisan('cip:providers-from-folders')->assertSuccessful();

        $this->assertSame(2, CipProvider::count());

        $codes = CipProvider::pluck('code');
        $this->assertSame(2, $codes->unique()->count());
    }

    public function test_client_folders_land_under_their_provider_folder(): void
    {
        $this->library(['GALAXY', 'PRIVATE']);
        $this->artisan('cip:providers-from-folders')->assertSuccessful();

        $company = \App\Models\Company::create(['uid' => 'galaxy-co', 'name' => 'Galaxy Consultants']);
        CipProvider::where('name', 'GALAXY')->firstOrFail()
            ->forceFill(['company_id' => $company->id])->save();

        $referred = \App\Models\Client::create([
            'uid' => 'ref-1', 'name' => 'Chen Wei',
            'referral_type' => 'company', 'referred_by_company_id' => $company->id, 'data' => [],
        ]);
        $walkIn = \App\Models\Client::create([
            'uid' => 'walkin-1', 'name' => 'Priya Sharma', 'data' => [],
        ]);

        $referredFolder = \App\Support\Files\FolderProvisioner::provisionClientFolder($referred);
        $walkInFolder = \App\Support\Files\FolderProvisioner::provisionClientFolder($walkIn);

        $this->assertSame('GALAXY', $referredFolder->parent->name);
        // No provider matches, so the private-clients bucket takes it in.
        $this->assertSame('PRIVATE', $walkInFolder->parent->name);
        // The standalone clients root never came back to hold either.
        $this->assertSame(0, Folder::whereNull('parent_id')
            ->where('folder_type', Folder::TYPE_ROOT)->count());
    }

    public function test_an_existing_provider_is_linked_not_duplicated(): void
    {
        $root = $this->library(['ARTON CAPITAL']);

        $existing = CipProvider::create(['name' => 'Arton Capital', 'code' => 'ART', 'active' => true]);

        $this->artisan('cip:providers-from-folders')->assertSuccessful();

        $this->assertSame(1, CipProvider::count());
        $this->assertSame(
            Folder::where('parent_id', $root->id)->value('id'),
            $existing->fresh()->folder_id,
        );
    }
}
