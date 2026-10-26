<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class ProviderContactTransferTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_staff_can_move_a_contact_to_another_service_provider(): void
    {
        $staff = $this->staff();
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $igraphix = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);

        Client::create([
            'uid' => 'sarah-cheng',
            'name' => 'Sarah Cheng',
            'company_id' => $galaxy->id,
            'company' => 'Galaxy Partners',
            'email' => 'sarah@galaxy.example',
            'data' => ['work' => ['company' => 'Galaxy Partners', 'jobTitle' => 'Advisor']],
        ]);
        Client::create([
            'uid' => 'stays-put',
            'name' => 'Stays Put',
            'company_id' => $galaxy->id,
            'email' => 'stays@galaxy.example',
            'data' => [],
        ]);

        $this->actingAs($staff)->getJson('/portal/companies')->assertOk();

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/contacts/sarah-cheng/transfer', [
                'companyId' => 'igraphix',
            ])
            ->assertOk()
            ->assertJsonPath('clientId', 'sarah-cheng')
            ->assertJsonPath('fromId', 'galaxy')
            ->assertJsonPath('toId', 'igraphix');

        $sarah = Client::where('uid', 'sarah-cheng')->first();
        $this->assertSame($igraphix->id, $sarah->company_id);
        $this->assertSame('iGraphix', $sarah->company);
        $this->assertSame('iGraphix', $sarah->data['work']['company']);
        $this->assertSame('Advisor', $sarah->data['work']['jobTitle']);
        $this->assertSame($galaxy->id, Client::where('uid', 'stays-put')->value('company_id'));

        $companies = collect($this->actingAs($staff)->getJson('/portal/companies')->json('companies'));
        $this->assertSame(
            ['stays-put'],
            collect($companies->firstWhere('id', 'galaxy')['people'])->pluck('id')->all(),
        );
        $this->assertSame(
            ['sarah-cheng'],
            collect($companies->firstWhere('id', 'igraphix')['people'])->pluck('id')->all(),
        );
    }

    public function test_portal_access_and_an_open_invitation_move_with_the_contact(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $igraphix = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);

        $login = User::factory()->create([
            'name' => 'Maya Contact',
            'email' => 'maya@galaxy.example',
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $client = Client::create([
            'uid' => 'maya-contact',
            'name' => 'Maya Contact',
            'company_id' => $galaxy->id,
            'company' => 'Galaxy Partners',
            'email' => 'maya@galaxy.example',
            'user_id' => $login->id,
            'data' => [],
        ]);

        $member = CompanyMember::create([
            'company_id' => $galaxy->id,
            'user_id' => $login->id,
            'client_id' => $client->id,
            'name' => 'Maya Contact',
            'email' => 'maya@galaxy.example',
            'role' => 'member',
            'is_primary' => true,
            'can_invite_others' => true,
            'status' => CompanyMember::STATUS_ACTIVE,
            'added_by' => $staff->id,
        ]);
        $galaxy->forceFill(['notification_member_id' => $member->id])->saveQuietly();

        $invited = Client::create([
            'uid' => 'lee-pending',
            'name' => 'Lee Pending',
            'company_id' => $galaxy->id,
            'email' => 'lee@galaxy.example',
            'data' => [],
        ]);
        $invitedMember = CompanyMember::create([
            'company_id' => $galaxy->id,
            'client_id' => $invited->id,
            'name' => 'Lee Pending',
            'email' => 'lee@galaxy.example',
            'role' => 'member',
            'status' => CompanyMember::STATUS_INVITED,
            'added_by' => $staff->id,
        ]);
        $invitation = Invitation::create([
            'uuid' => (string) Str::uuid(),
            'type' => Invitation::TYPE_COMPANY_MEMBER,
            'token_hash' => hash('sha256', Str::random(48)),
            'email' => 'lee@galaxy.example',
            'name' => 'Lee Pending',
            'client_id' => $invited->id,
            'company_id' => $galaxy->id,
            'role' => 'Client',
            'access' => ['companyMemberUuid' => $invitedMember->uuid, 'companyRole' => 'Company member'],
            'status' => Invitation::STATUS_SENT,
            'invited_by' => $staff->id,
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/contacts/maya-contact/transfer', [
                'companyId' => 'igraphix',
            ])
            ->assertOk();

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/contacts/lee-pending/transfer', [
                'companyId' => 'igraphix',
            ])
            ->assertOk();

        $moved = CompanyMember::query()
            ->where('company_id', $igraphix->id)
            ->where('user_id', $login->id)
            ->first();
        $this->assertNotNull($moved);
        $this->assertSame(CompanyMember::STATUS_ACTIVE, $moved->status);
        $this->assertSame($client->id, $moved->client_id);
        $this->assertFalse($moved->is_primary);
        $this->assertTrue($moved->can_invite_others);
        $this->assertSame(CompanyMember::STATUS_REMOVED, $member->fresh()->status);
        $this->assertFalse($member->fresh()->is_primary);
        $this->assertNull($galaxy->fresh()->notification_member_id);

        $this->assertDatabaseMissing('company_members', ['id' => $invitedMember->id]);
        $landed = CompanyMember::query()
            ->where('company_id', $igraphix->id)
            ->whereRaw('LOWER(email) = ?', ['lee@galaxy.example'])
            ->first();
        $this->assertNotNull($landed);
        $this->assertSame(CompanyMember::STATUS_INVITED, $landed->status);

        $invitation->refresh();
        $this->assertSame($igraphix->id, $invitation->company_id);
        $this->assertNull($invitation->cancelled_at);
        $this->assertSame($landed->uuid, $invitation->access['companyMemberUuid']);
        $this->assertSame(1, Client::where('email', 'lee@galaxy.example')->count());

        Mail::assertNothingSent();
    }

    public function test_a_contact_cannot_be_moved_onto_the_firm_they_are_already_on(): void
    {
        $staff = $this->staff();
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        Client::create([
            'uid' => 'sarah-cheng',
            'name' => 'Sarah Cheng',
            'company_id' => $galaxy->id,
            'data' => [],
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/contacts/sarah-cheng/transfer', [
                'companyId' => 'galaxy',
            ])
            ->assertStatus(422);

        $this->assertSame($galaxy->id, Client::where('uid', 'sarah-cheng')->value('company_id'));
    }

    public function test_a_contact_cannot_be_taken_off_a_firm_they_are_not_on(): void
    {
        $staff = $this->staff();
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $igraphix = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);
        Client::create([
            'uid' => 'sarah-cheng',
            'name' => 'Sarah Cheng',
            'company_id' => $galaxy->id,
            'data' => [],
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/igraphix/contacts/sarah-cheng/transfer', [
                'companyId' => 'galaxy',
            ])
            ->assertStatus(422);
    }

    public function test_an_applicant_is_not_transferred_as_a_contact(): void
    {
        config(['services.cip.enabled' => true]);

        $staff = $this->staff();
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $igraphix = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);
        $provider = \App\Models\CipProvider::create([
            'name' => 'Galaxy Partners',
            'code' => 'GAL',
            'company_id' => $galaxy->id,
            'active' => true,
        ]);
        $applicant = Client::create([
            'uid' => 'emma-example',
            'name' => 'Emma Example',
            'company_id' => $galaxy->id,
            'data' => [],
        ]);
        Applications::create($provider, $staff, ['client_id' => $applicant->id]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/contacts/emma-example/transfer', [
                'companyId' => 'igraphix',
            ])
            ->assertStatus(422);

        $this->assertSame($galaxy->id, $applicant->fresh()->company_id);
    }

    public function test_a_service_provider_admin_cannot_transfer_a_contact(): void
    {
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $igraphix = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);
        Client::create([
            'uid' => 'sarah-cheng',
            'name' => 'Sarah Cheng',
            'company_id' => $galaxy->id,
            'data' => [],
        ]);

        $admin = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/companies/galaxy/contacts/sarah-cheng/transfer', [
                'companyId' => 'igraphix',
            ])
            ->assertForbidden();

        $this->assertSame($galaxy->id, Client::where('uid', 'sarah-cheng')->value('company_id'));
    }
}
