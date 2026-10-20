<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CipRepairProvidersTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_company_takes_the_unlinked_provider_of_the_same_firm(): void
    {
        $company = Company::create(['uid' => 'respect', 'name' => 'Respect Services']);
        $provider = CipProvider::create([
            'name' => 'RESPECT SERVICES',
            'code' => 'RES',
            'active' => true,
        ]);

        $this->artisan('cip:repair-providers', ['--apply' => true])->assertSuccessful();

        $this->assertSame($company->id, $provider->fresh()->company_id);
        $this->assertSame('RES', $provider->fresh()->code);
        $this->assertSame(1, CipProvider::query()->where('code', 'like', 'RES%')->count());
    }

    public function test_a_company_with_no_match_is_given_the_suggested_code(): void
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        $this->artisan('cip:repair-providers', ['--apply' => true])->assertSuccessful();

        $this->assertSame('GAL', $company->fresh()->cipProvider->code);
    }

    public function test_a_referred_private_folder_moves_and_an_unreferred_one_stays(): void
    {
        $owner = User::factory()->create();
        $root = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Citizenship Applications',
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
        $privateFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'PRIVATE',
            'parent_id' => $root->id,
            'folder_type' => Folder::TYPE_USER,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
        CipProvider::create([
            'name' => 'PRIVATE',
            'code' => CipProvider::PRIVATE_CLIENT_CODE,
            'folder_id' => $privateFolder->id,
            'active' => true,
        ]);

        $company = Company::create(['uid' => 'respect', 'name' => 'Respect Services']);
        $home = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'RESPECT SERVICES',
            'parent_id' => $root->id,
            'folder_type' => Folder::TYPE_USER,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
        CipProvider::create([
            'name' => 'RESPECT SERVICES',
            'code' => 'RES',
            'company_id' => $company->id,
            'folder_id' => $home->id,
            'active' => true,
        ]);

        $referred = $this->drawer($privateFolder, 'LEON LI');
        Client::create([
            'uid' => 'leon',
            'name' => 'LEON LI',
            'folder_id' => $referred->id,
            'referred_by_company_id' => $company->id,
            'referral_type' => Client::REFERRAL_COMPANY,
            'data' => [],
        ]);

        $own = $this->drawer($privateFolder, 'PRIVATE CLIENT');
        Client::create([
            'uid' => 'own',
            'name' => 'PRIVATE CLIENT',
            'folder_id' => $own->id,
            'data' => [],
        ]);

        $this->artisan('cip:repair-providers', ['--apply' => true])->assertSuccessful();

        $this->assertSame($home->id, $referred->fresh()->parent_id);
        $this->assertSame($privateFolder->id, $own->fresh()->parent_id);
    }

    private function drawer(Folder $parent, string $name): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'parent_id' => $parent->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'owner_id' => $parent->owner_id,
            'created_by' => $parent->owner_id,
        ]);
    }
}
