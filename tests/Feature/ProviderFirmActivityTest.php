<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\FileActivity;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A Service Provider admin's Overview is their firm: who signed in and out,
 * who edited which file, and who is assigned on an application. A regular
 * contact at the same firm does not get that trail, and Connectors is closed
 * to both of them.
 */
class ProviderFirmActivityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    /** @return array{0: Company, 1: CipProvider} */
    private function providerFirm(string $name, string $code): array
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $name,
            'status' => 'active',
        ]);
        $provider = CipProvider::create([
            'name' => $name,
            'code' => $code,
            'company_id' => $company->id,
        ]);

        return [$company, $provider];
    }

    public function test_a_service_provider_admin_sees_their_firms_activity_only(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR, ['name' => 'TMA Admin']);
        [$company, $provider] = $this->providerFirm('Galaxy', 'GAL');
        [$otherCompany, $otherProvider] = $this->providerFirm('Bluemina', 'BLU');

        $admin = $this->user(Role::SERVICE_PROVIDER_ADMIN, [
            'name' => 'Gil Admin',
            'email' => 'gil@galaxy.example',
        ]);
        $contact = $this->user(Role::CLIENT, [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.example',
        ]);
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Rita Officer']);
        $stranger = $this->user(Role::CLIENT, ['name' => 'Eve Blue', 'email' => 'eve@bluemina.example']);

        CompanyMembers::add($company, [
            'email' => $admin->email,
            'name' => $admin->name,
            'role' => CompanyRoles::MEMBER,
        ], $tma);
        CompanyMembers::add($company, [
            'email' => $contact->email,
            'name' => $contact->name,
            'role' => CompanyRoles::MEMBER,
        ], $tma);
        CompanyMembers::add($otherCompany, [
            'email' => $stranger->email,
            'name' => $stranger->name,
            'role' => CompanyRoles::MEMBER,
        ], $tma);

        $applicant = Client::create([
            'uid' => 'ada-cole',
            'name' => 'Ada Cole',
            'company_id' => $company->id,
            'data' => [],
        ]);
        $root = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Ada Cole',
            'owner_id' => $officer->id,
            'created_by' => $officer->id,
            'client_id' => $applicant->id,
        ]);
        $nested = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Identity',
            'parent_id' => $root->id,
            'owner_id' => $officer->id,
            'created_by' => $officer->id,
        ]);
        $passport = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Passport.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 100,
            'disk' => 'local',
            'storage_path' => 'vault/passport.pdf',
            'folder_id' => $nested->id,
            'owner_id' => $officer->id,
            'uploaded_by' => $officer->id,
        ]);
        $application = CipApplication::create([
            'provider_id' => $provider->id,
            'client_id' => $applicant->id,
            'created_by' => $admin->id,
        ]);
        $application->forceFill(['folder_id' => $root->id])->save();

        $elsewhere = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Bluemina',
            'owner_id' => $stranger->id,
            'created_by' => $stranger->id,
        ]);
        $otherFile = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Other.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 100,
            'disk' => 'local',
            'storage_path' => 'vault/other.pdf',
            'folder_id' => $elsewhere->id,
            'owner_id' => $stranger->id,
            'uploaded_by' => $stranger->id,
        ]);
        CipApplication::create([
            'provider_id' => $otherProvider->id,
            'created_by' => $tma->id,
        ])->forceFill(['folder_id' => $elsewhere->id])->save();

        ActivityLogger::log([
            'actor' => $contact,
            'type' => 'security.login',
            'description' => 'Dana Reed signed in',
        ]);
        ActivityLogger::log([
            'actor' => $officer,
            'client' => $applicant,
            'type' => 'client.updated',
            'description' => 'Updated Ada Cole',
        ]);
        ActivityLogger::log([
            'actor' => $stranger,
            'type' => 'security.login',
            'description' => 'Eve Blue signed in',
        ]);

        FileActivity::create([
            'user_id' => $officer->id,
            'item_type' => 'file',
            'item_id' => $passport->id,
            'action' => 'upload',
            'meta' => ['name' => 'Passport.pdf'],
            'created_at' => now(),
        ]);
        FileActivity::create([
            'user_id' => $officer->id,
            'item_type' => 'file',
            'item_id' => $passport->id,
            'action' => 'rename',
            'meta' => ['from' => 'scan.pdf', 'to' => 'Passport.pdf'],
            'created_at' => now(),
        ]);
        FileActivity::create([
            'user_id' => $officer->id,
            'item_type' => 'file',
            'item_id' => $passport->id,
            'action' => 'preview',
            'created_at' => now(),
        ]);
        FileActivity::create([
            'user_id' => $stranger->id,
            'item_type' => 'file',
            'item_id' => $otherFile->id,
            'action' => 'upload',
            'meta' => ['name' => 'Other.pdf'],
            'created_at' => now(),
        ]);

        AuthEvent::create(['user_id' => $contact->id, 'event' => 'login', 'created_at' => now()]);
        AuthEvent::create(['user_id' => $contact->id, 'event' => 'logout', 'created_at' => now()]);
        AuthEvent::create(['user_id' => $stranger->id, 'event' => 'login', 'created_at' => now()]);

        $feed = collect($this->actingAs($admin)->getJson('/portal/activity')->assertOk()->json('items'));
        $descriptions = $feed->pluck('description')->all();

        $this->assertContains('Dana Reed signed in', $descriptions);
        $this->assertContains('Updated Ada Cole', $descriptions);
        $this->assertContains('uploaded “Passport.pdf”', $descriptions);
        $this->assertContains('renamed “scan.pdf” to “Passport.pdf”', $descriptions);
        $this->assertNotContains('Eve Blue signed in', $descriptions);
        $this->assertFalse($feed->contains(fn ($row) => str_contains((string) ($row['description'] ?? ''), 'Other.pdf')));
        $this->assertFalse($feed->contains(fn ($row) => ($row['action'] ?? null) === 'preview'));
        $this->assertFalse($feed->contains(fn ($row) => ($row['ip'] ?? null) !== null));
        $upload = $feed->first(fn ($row) => ($row['description'] ?? '') === 'uploaded “Passport.pdf”');
        $this->assertSame('Rita Officer', $upload['actor']['name']);
        $this->assertFalse($this->actingAs($admin)->getJson('/portal/activity')->json('isAdmin'));

        $filesOnly = collect($this->actingAs($admin)->getJson('/portal/activity?module=files')->assertOk()->json('items'));
        $this->assertTrue($filesOnly->contains(fn ($row) => $row['description'] === 'uploaded “Passport.pdf”'));
        $this->assertFalse($filesOnly->contains(fn ($row) => $row['description'] === 'Dana Reed signed in'));

        $found = collect($this->actingAs($admin)->getJson('/portal/activity?search=Passport')->assertOk()->json('items'));
        $this->assertTrue($found->contains(fn ($row) => str_contains($row['description'], 'Passport.pdf')));

        $own = collect($this->actingAs($contact)->getJson('/portal/activity')->assertOk()->json('items'));
        $this->assertContains('Dana Reed signed in', $own->pluck('description')->all());
        $this->assertNotContains('Updated Ada Cole', $own->pluck('description')->all());
        $this->assertFalse($own->contains(fn ($row) => str_contains((string) ($row['description'] ?? ''), 'Passport.pdf')));

        $signIns = collect($this->actingAs($admin)->getJson('/portal/sign-ins')->assertOk()->json('items'));
        $this->assertEqualsCanonicalizing(
            ['Dana Reed signed in', 'Dana Reed signed out'],
            $signIns->pluck('description')->all(),
        );

        $this->actingAs($contact)->getJson('/portal/sign-ins')->assertForbidden();
    }

    public function test_an_application_assignment_is_readable_by_the_filing_firm(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR, ['name' => 'TMA Admin']);
        [$company, $provider] = $this->providerFirm('Galaxy', 'GAL');
        [$other] = $this->providerFirm('Bluemina', 'BLU');
        $admin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example', 'name' => 'Gil Admin']);
        $contact = $this->user(Role::CLIENT, ['email' => 'dana@galaxy.example', 'name' => 'Dana Reed']);
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Rita Officer']);
        CompanyMembers::add($company, ['email' => $admin->email, 'name' => $admin->name, 'role' => CompanyRoles::MEMBER], $tma);
        CompanyMembers::add($company, ['email' => $contact->email, 'name' => $contact->name, 'role' => CompanyRoles::MEMBER], $tma);

        $applicant = Client::create([
            'uid' => 'ada-cole',
            'name' => 'Ada Cole',
            'company_id' => $company->id,
            'data' => [],
        ]);
        $stranger = Client::create([
            'uid' => 'eve-blue',
            'name' => 'Eve Blue',
            'company_id' => $other->id,
            'data' => [],
        ]);
        CipApplication::create([
            'provider_id' => $provider->id,
            'client_id' => $applicant->id,
            'created_by' => $admin->id,
        ]);
        ClientAssignment::create([
            'client_id' => $applicant->id,
            'user_id' => $officer->id,
            'role' => 'lead',
            'permission_level' => 'editor',
            'status' => ClientAssignment::STATUS_ACTIVE,
            'assigned_by' => $tma->id,
        ]);

        $this->actingAs($admin)->getJson('/portal/clients/ada-cole/assignments')
            ->assertOk()
            ->assertJsonPath('assignments.0.name', 'Rita Officer')
            ->assertJsonPath('assignable', []);

        $this->actingAs($contact)->getJson('/portal/clients/ada-cole/assignments')
            ->assertOk()
            ->assertJsonPath('assignments.0.name', 'Rita Officer');

        $this->actingAs($admin)->getJson('/portal/clients/eve-blue/assignments')->assertNotFound();

        $this->actingAs($admin)->postJson('/portal/clients/ada-cole/assignments', [
            'userId' => $contact->id,
        ])->assertForbidden();
    }

    public function test_connectors_are_closed_to_service_providers(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm('Galaxy', 'GAL');
        $admin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $contact = $this->user(Role::CLIENT, ['email' => 'dana@galaxy.example']);
        $private = $this->user(Role::CLIENT, ['email' => 'pat@example.com']);
        CompanyMembers::add($company, ['email' => $admin->email, 'name' => $admin->name, 'role' => CompanyRoles::MEMBER], $tma);
        CompanyMembers::add($company, ['email' => $contact->email, 'name' => $contact->name, 'role' => CompanyRoles::MEMBER], $tma);

        $this->assertFalse(Role::canViewSettingsPage($admin, 'connectors'));
        $this->assertFalse(Role::canViewSettingsPage($contact, 'connectors'));
        $this->assertTrue(Role::canViewSettingsPage($private, 'connectors'));
        $this->assertTrue(Role::canViewSettingsPage($tma, 'connectors'));

        $this->actingAs($admin)->getJson('/admin/connectors')->assertForbidden();
        $this->actingAs($contact)->getJson('/admin/connectors')->assertForbidden();
        $this->actingAs($private)->getJson('/admin/connectors')->assertOk();
    }
}
