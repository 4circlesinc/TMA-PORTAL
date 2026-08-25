<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\Folder;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Companies\CompanyMembers;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 19 — the invitation management area, and Phase 20 — access that
 * settles itself when the thing it hangs off is archived or suspended.
 */
class InvitationManagementTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return $this->staff('Administrator');
    }

    private function staff(string $type = 'Employee', array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $o));
    }

    private function client(array $o = []): Client
    {
        return Client::create(array_merge([
            'uid' => 'acme-co', 'name' => 'Acme Co', 'email' => 'owner@acme.test',
            'initial' => 'A', 'initial_color' => 'blue', 'data' => [],
        ], $o));
    }

    private function invite(User $by, Client $client): Invitation
    {
        $this->actingAs($by)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        return Invitation::latest('id')->first();
    }

    // ------------------------------------------ management area (Phase 19)

    public function test_the_screen_lists_outstanding_invitations_by_default(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $this->invite($admin, $client);

        $this->actingAs($admin)->getJson('/portal/people/prospects')
            ->assertOk()
            ->assertJsonPath('prospects.0.email', 'owner@acme.test')
            ->assertJsonPath('prospects.0.source', 'invite')
            ->assertJsonPath('prospects.0.invitedBy', $admin->name)
            ->assertJsonPath('counts.waiting', 1);
    }

    public function test_accepted_and_cancelled_invitations_are_reachable_by_filter(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $accepted = $this->client();
        $cancelled = $this->client(['uid' => 'wayne-co', 'name' => 'Wayne Co', 'email' => 'b@wayne.test']);

        $a = $this->invite($admin, $accepted);
        $c = $this->invite($admin, $cancelled);

        $a->forceFill(['status' => 'accepted', 'accepted_at' => now()])->save();
        $this->actingAs($admin)->postJson("/portal/invitations/{$c->uuid}/cancel")->assertOk();

        // Neither shows in the default "still waiting" view…
        $this->actingAs($admin)->getJson('/portal/people/prospects')
            ->assertOk()->assertJsonCount(0, 'prospects');

        // …but each is one filter away.
        $this->actingAs($admin)->getJson('/portal/people/prospects?status=accepted')
            ->assertOk()
            ->assertJsonCount(1, 'prospects')
            ->assertJsonPath('prospects.0.status', 'accepted');

        $this->actingAs($admin)->getJson('/portal/people/prospects?status=cancelled')
            ->assertOk()
            ->assertJsonCount(1, 'prospects')
            ->assertJsonPath('prospects.0.status', 'cancelled');
    }

    public function test_a_failed_send_is_visible_with_its_reason(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $invitation = $this->invite($admin, $client);

        $invitation->forceFill([
            'status' => 'failed',
            'last_error' => 'Microsoft Graph sendMail failed (404): The mailbox is inactive.',
        ])->save();

        $row = $this->actingAs($admin)->getJson('/portal/people/prospects?status=failed')
            ->assertOk()->json('prospects.0');

        $this->assertSame('failed', $row['status']);
        $this->assertStringContainsString('mailbox is inactive', $row['lastError']);
        // A failed send has not killed the invitation — it can still be chased.
        $this->assertTrue($row['canResend']);
    }

    public function test_an_expired_invitation_reports_itself_as_expired(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $invitation = $this->invite($admin, $client);
        $invitation->forceFill(['expires_at' => now()->subDay()])->save();

        $row = $this->actingAs($admin)->getJson('/portal/people/prospects?status=expired')
            ->assertOk()->json('prospects.0');

        $this->assertSame('expired', $row['status']);
        $this->assertTrue($row['expired']);
        $this->assertFalse($row['canCancel']);
        // Expired invitations may still be revived.
        $this->assertTrue($row['canResend']);
    }

    public function test_settled_views_do_not_include_dormant_accounts(): void
    {
        Mail::fake();
        $admin = $this->admin();
        // An account that never signed in — a "prospect", but not an invitation.
        $this->staff('Employee', ['password_auto' => true]);

        $this->actingAs($admin)->getJson('/portal/people/prospects')
            ->assertOk()->assertJsonCount(1, 'prospects');

        $this->actingAs($admin)->getJson('/portal/people/prospects?status=accepted')
            ->assertOk()->assertJsonCount(0, 'prospects');
    }

    public function test_the_row_carries_what_the_actions_need(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $invitation = $this->invite($admin, $client);

        $row = $this->actingAs($admin)->getJson('/portal/people/prospects')->json('prospects.0');

        $this->assertSame($invitation->uuid, $row['invitationId']);
        $this->assertNotNull($row['expiresAt']);
        $this->assertTrue($row['canCancel']);

        // And those ids really drive the endpoints the menu calls.
        $this->actingAs($admin)->postJson("/portal/invitations/{$row['invitationId']}/link")
            ->assertOk()->assertJsonStructure(['url']);
    }

    // -------------------------------------------- access sync (Phase 20)

    private function clientFolder(Client $client, User $owner): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $client->name,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
    }

    public function test_suspending_an_account_removes_every_grant_it_held(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();
        $company = Company::create(['uid' => 'acme-group', 'name' => 'Acme Group']);
        $folder = $this->clientFolder($client, $admin);

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'role' => 'account_manager', 'level' => 'editor',
        ])->assertOk();
        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $emp->id, 'level' => 'editor', 'appliesToClients' => 'existing_future',
        ])->assertOk();

        $this->assertSame('editor', FileAccess::folderRole($emp->fresh(), $folder));

        $this->actingAs($admin)->postJson("/admin/users/{$emp->id}/suspend")->assertOk();

        $this->assertNull(
            FileAccess::folderRole($emp->fresh(), $folder),
            'a suspended account kept its file access'
        );
        $this->assertSame('ended', ClientAssignment::first()->status);
        $this->assertSame('ended', CompanyStaffAssignment::first()->status);
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'account.access_removed']);
    }

    public function test_suspending_a_company_member_takes_their_membership_with_it(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = Company::create(['uid' => 'acme-group', 'name' => 'Acme Group']);
        $person = $this->staff('Client', ['email' => 'dana@acme.test']);

        CompanyMembers::add($company, [
            'email' => 'dana@acme.test', 'role' => 'primary',
        ], $admin);
        $this->assertNotNull(CompanyMember::active()->where('user_id', $person->id)->first());

        $this->actingAs($admin)->postJson("/admin/users/{$person->id}/suspend")->assertOk();

        $this->assertNull(CompanyMember::active()->where('user_id', $person->id)->first());
    }

    public function test_archiving_a_client_ends_its_assignments_and_withdraws_its_invitation(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();
        $folder = $this->clientFolder($client, $admin);

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'level' => 'editor',
        ])->assertOk();
        $invitation = $this->invite($admin, $client);

        $this->actingAs($admin)->deleteJson("/portal/clients/{$client->uid}")->assertOk();

        $this->assertSame('ended', ClientAssignment::first()->status);
        $this->assertSame('cancelled', $invitation->fresh()->status);
        $this->assertNull(FileAccess::folderRole($emp->fresh(), $folder));
    }

    public function test_an_invitation_withdrawn_by_archiving_can_no_longer_be_accepted(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        $token = null;
        Mail::assertSent(Postcard::class, function ($mail) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $token = $m[1];
            }

            return true;
        });

        $this->actingAs($admin)->deleteJson("/portal/clients/{$client->uid}")->assertOk();

        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$token}")->assertOk()->assertSee('withdrawn');

        $this->post("/invite/{$token}", [
            'first_name' => 'Dana', 'last_name' => 'Reed', 'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ]);
        $this->assertDatabaseMissing('users', ['email' => 'owner@acme.test']);
    }

    public function test_archiving_a_company_ends_its_staff_assignments(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $company = Company::create(['uid' => 'acme-group', 'name' => 'Acme Group']);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $emp->id, 'level' => 'editor', 'appliesToClients' => 'existing',
        ])->assertOk();

        $this->actingAs($admin)->deleteJson("/portal/companies/{$company->uid}")->assertOk();

        $this->assertSame('ended', CompanyStaffAssignment::first()->status);
    }
}
