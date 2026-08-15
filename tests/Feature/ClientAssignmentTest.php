<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientAssignmentTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function makeClient(User $admin, string $uid = 'vernon-francis', string $name = 'Vernon Francis'): Client
    {
        $this->actingAs($admin)->postJson('/portal/clients', [
            'uid' => $uid, 'name' => $name, 'profile' => ['firstName' => $name],
        ])->assertOk();

        return Client::where('uid', $uid)->first();
    }

    public function test_admin_assigns_and_lists_staff_with_a_primary(): void
    {
        $admin = $this->user('Administrator');
        $staff = $this->user('Employee');
        $this->makeClient($admin);

        $this->actingAs($admin)->postJson('/portal/clients/vernon-francis/assignments', [
            'userId' => $staff->id, 'level' => 'manager', 'primary' => true,
        ])->assertOk()
            ->assertJsonPath('assignments.0.userId', $staff->id)
            ->assertJsonPath('assignments.0.level', 'manager')
            ->assertJsonPath('assignments.0.primary', true);

        $this->actingAs($admin)->getJson('/portal/clients/vernon-francis/assignments')
            ->assertOk()
            ->assertJsonCount(1, 'assignments')
            ->assertJsonPath('assignments.0.name', $staff->name);
    }

    public function test_a_client_cannot_be_assigned_to_another_client_account(): void
    {
        $admin = $this->user('Administrator');
        $clientUser = $this->user('Client');
        $this->makeClient($admin);

        $this->actingAs($admin)->postJson('/portal/clients/vernon-francis/assignments', [
            'userId' => $clientUser->id, 'level' => 'editor',
        ])->assertStatus(422);
    }

    public function test_staff_sees_their_assigned_clients_and_only_those(): void
    {
        $admin = $this->user('Administrator');
        $staff = $this->user('Reviewing Officer');
        $mine = $this->makeClient($admin, 'client-a', 'Client A');
        $this->makeClient($admin, 'client-b', 'Client B');

        $this->actingAs($admin)->postJson('/portal/clients/client-a/assignments', [
            'userId' => $staff->id, 'level' => 'view_files',
        ])->assertOk();

        $res = $this->actingAs($staff)->getJson('/portal/clients/assigned-to-me')->assertOk();
        $res->assertJsonCount(1, 'clients')
            ->assertJsonPath('clients.0.id', 'client-a')
            ->assertJsonPath('clients.0.folderUuid', Folder::find($mine->folder_id)->uuid);
    }

    public function test_assigned_client_folder_appears_in_folder_shortcuts_groups(): void
    {
        $admin = $this->user('Administrator');
        $staff = $this->user('Reviewing Officer');
        $this->makeClient($admin);

        $this->actingAs($admin)->postJson('/portal/clients/vernon-francis/assignments', [
            'userId' => $staff->id, 'level' => 'editor',
        ])->assertOk();

        // Also an organization folder open to all staff.
        $this->actingAs($admin)->postJson('/portal/file-library/organization-folders', [
            'name' => 'Templates', 'audience' => 'all_staff',
        ])->assertCreated();

        $res = $this->actingAs($staff)->getJson('/portal/files/shortcuts')->assertOk();
        $res->assertJsonPath('groups.assignedClients.0.name', 'Vernon Francis')
            ->assertJsonPath('groups.organization.0.name', 'Templates');
    }

    public function test_client_gets_no_assigned_or_organization_groups(): void
    {
        $admin = $this->user('Administrator');
        $clientUser = $this->user('Client');
        $this->makeClient($admin);
        $this->actingAs($admin)->postJson('/portal/file-library/organization-folders', [
            'name' => 'Templates', 'audience' => 'all_staff',
        ])->assertCreated();

        $res = $this->actingAs($clientUser)->getJson('/portal/files/shortcuts')->assertOk();
        $res->assertJsonCount(0, 'groups.assignedClients')
            ->assertJsonCount(0, 'groups.organization');
    }

    public function test_default_client_subfolders_setting_round_trips(): void
    {
        $admin = $this->user('Administrator');

        $this->actingAs($admin)->putJson('/portal/file-library/settings', [
            'clientSubfolders' => ['Matters', ' Billing ', ''],
            'autoCreateStaffFolder' => true,
        ])->assertOk()
            ->assertJsonPath('settings.clientSubfolders', ['Matters', 'Billing'])
            ->assertJsonPath('settings.autoCreateStaffFolder', true);

        $this->actingAs($admin)->getJson('/portal/file-library/settings')
            ->assertOk()
            ->assertJsonPath('settings.autoCreateStaffFolder', true);
    }
    public function test_the_assignable_list_offers_only_working_staff(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $admin->forceFill(['name' => 'An Admin'])->save();
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $officer->forceFill(['name' => 'An Officer'])->save();
        $system = $this->user(Role::REVIEWING_OFFICER);
        $system->forceFill(['name' => 'The Firm', 'email' => (string) config('portal.system_account_email')])->save();
        $parked = $this->user(Role::EMPLOYEE);
        $parked->forceFill(['name' => 'A Parked Account'])->save();
        $client = Client::create(['uid' => 'assignable-co', 'name' => 'Assignable Co', 'data' => []]);

        $names = collect(
            $this->actingAs($admin)->getJson('/portal/clients/'.$client->uid.'/assignments')
                ->assertOk()->json('assignable')
        )->pluck('name');

        // Administrators already reach every client, a parked Employee cannot
        // get past the role-pending screen to open one, and the firm's own
        // service account is not somebody to hand work to.
        $this->assertContains('An Officer', $names->all());
        $this->assertNotContains('An Admin', $names->all());
        $this->assertNotContains('A Parked Account', $names->all());
        $this->assertNotContains('The Firm', $names->all());
    }
}
