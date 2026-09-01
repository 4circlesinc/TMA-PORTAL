<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\Folder;
use App\Models\Invitation;
use App\Models\Share;
use App\Models\User;
use App\Support\Companies\CompanyAccess;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phases 11-16 — company accounts, their members and permissions, company-level
 * file inheritance, and assigning the firm's own staff to a whole company.
 */
class CompanyAccountsTest extends TestCase
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

    private function company(array $o = []): Company
    {
        return Company::create(array_merge([
            'uid' => 'acme-group',
            'name' => 'Acme Group',
            'status' => 'active',
        ], $o));
    }

    /** An active member with a real account behind it. */
    private function memberWithAccount(Company $company, string $role, User $by): array
    {
        $user = $this->staff('Client', ['email' => $role.'@acme.test']);
        $member = CompanyMembers::add($company, [
            'name' => ucfirst($role).' Person',
            'email' => $user->email,
            'role' => $role,
        ], $by);

        return [$user, $member->fresh()];
    }

    // ------------------------------------------------ company record (Ph. 11)

    public function test_a_company_holds_a_full_account_record(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/portal/companies', [
            'name' => 'Acme Group',
            'companyType' => 'limited_company',
            'registrationNumber' => 'RC-8891',
            'industry' => 'Hospitality',
            'email' => 'hello@acme.test',
            'phone' => '+1 758 555 0100',
            'website' => 'acme.test',
            'address' => ['street' => '1 Bay Street', 'city' => 'Castries'],
            'billing' => ['contact' => 'accounts@acme.test', 'terms' => 'Net 30'],
            'status' => 'active',
        ])->assertCreated()
            ->assertJsonPath('company.companyType', 'limited_company')
            ->assertJsonPath('company.companyTypeLabel', 'Limited company')
            ->assertJsonPath('company.registrationNumber', 'RC-8891')
            ->assertJsonPath('company.industry', 'Hospitality')
            ->assertJsonPath('company.address.city', 'Castries')
            ->assertJsonPath('company.billing.terms', 'Net 30');
    }

    public function test_editing_one_section_does_not_blank_the_rest(): void
    {
        $admin = $this->admin();
        $company = $this->company(['industry' => 'Hospitality', 'phone' => '+1 758 555 0100']);

        $this->actingAs($admin)->patchJson("/portal/companies/{$company->uid}", [
            'email' => 'new@acme.test',
        ])->assertOk();

        $company->refresh();
        $this->assertSame('new@acme.test', $company->email);
        $this->assertSame('Hospitality', $company->industry);
        $this->assertSame('+1 758 555 0100', $company->phone);
    }

    // ------------------------------------------------ members (Phases 12-13)

    public function test_a_member_can_be_added_before_they_have_an_account(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed', 'email' => 'dana@acme.test', 'role' => 'finance',
        ])->assertCreated()
            ->assertJsonPath('member.role', 'finance')
            ->assertJsonPath('member.roleLabel', 'Finance contact')
            ->assertJsonPath('member.hasAccount', false)
            ->assertJsonPath('member.status', 'invited');

        // Nobody is emailed until asked.
        Mail::assertNothingSent();
    }

    public function test_inviting_a_member_sends_the_company_invitation(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed', 'email' => 'dana@acme.test', 'role' => 'finance', 'invite' => true,
        ])->assertCreated()->json('member.id');

        $invitation = Invitation::first();
        $this->assertSame('company_member', $invitation->type);
        $this->assertSame($company->id, $invitation->company_id);

        Mail::assertSent(Postcard::class, fn (Postcard $m) => str_contains($m->subjectLine, 'Acme Group'));
        $this->assertNotNull($uuid);
    }

    public function test_inviting_a_deleted_account_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $gone = $this->staff('Client', ['email' => 'gone@acme.test']);

        $this->actingAs($admin)->deleteJson('/admin/users/'.$gone->id)->assertOk();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'gone@acme.test', 'role' => 'member', 'invite' => true,
        ])->assertStatus(422)
            ->assertJsonPath('message', 'This address belongs to a deleted account. Restore it from the Recycle Bin first.');

        // The one email is the closure notice the delete sent; no invitation
        // went out to an address nobody can sign in with.
        Mail::assertSentCount(1);
        Mail::assertSent(Postcard::class, fn (Postcard $m) => $m->subjectLine === 'Your account has been closed');
        $this->assertSame(0, CompanyMember::count());
    }

    public function test_purging_an_account_frees_the_address_for_a_new_invite(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $login = $this->staff('Client', ['email' => 'igraphix@acme.test']);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'I Graphix',
            'email' => 'igraphix@acme.test',
            'role' => 'member',
        ])->assertCreated()->assertJsonPath('member.hasAccount', true);

        $this->actingAs($admin)->deleteJson('/admin/users/'.$login->id)->assertOk();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'igraphix@acme.test', 'role' => 'member', 'invite' => true,
        ])->assertStatus(422)
            ->assertJsonPath('message', 'This address belongs to a deleted account. Restore it from the Recycle Bin first.');

        $this->actingAs($admin)->deleteJson("/portal/admin/recycle-bin/user/{$login->id}")->assertOk();
        $this->assertFalse(User::withTrashed()->where('email', 'igraphix@acme.test')->exists());

        // The membership survived the purge instead of cascading away, so
        // adding the address back reuses its row rather than starting a
        // second one — and it comes back as somebody staff deliberately let
        // in, not as a leftover.
        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'igraphix@acme.test', 'role' => 'member',
        ])->assertCreated()->json('member.id');

        $this->assertSame(1, CompanyMember::where('company_id', $company->id)->count());

        $this->actingAs($admin)->getJson("/portal/companies/{$company->uid}/members")
            ->assertOk()
            ->assertJsonPath('members.0.hasAccount', false)
            ->assertJsonPath('members.0.email', 'igraphix@acme.test');

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members/{$uuid}/invite")
            ->assertOk();

        $token = null;
        Mail::assertSent(Postcard::class, function (Postcard $m) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $m->payload['button']['url'] ?? '', $x)) {
                $token = $x[1];
            }

            return true;
        });

        $this->app['auth']->forgetGuards();
        $this->post("/invite/{$token}", [
            'first_name' => 'Dana', 'last_name' => 'Reed', 'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ])->assertRedirect('/');

        $member = CompanyMember::where('uuid', $uuid)->first();
        $this->assertSame('active', $member->status);
        $this->assertSame('igraphix@acme.test', $member->user->email);
    }

    /**
     * Deleting somebody's account takes their company access away. Emptying
     * the Recycle Bin afterwards used to hand it back: parking the membership
     * so it would not cascade away with the login also reset it to `invited`
     * and cleared the removal, so the person reappeared in Access as though
     * an invitation were outstanding, with a Resend button on it.
     */
    public function test_emptying_the_recycle_bin_does_not_hand_back_company_access(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $login = $this->staff('Client', ['email' => 'travis@acme.test', 'name' => 'Travis Francis']);

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Travis Francis', 'email' => 'travis@acme.test', 'role' => 'member',
        ])->assertCreated()->json('member.id');

        $this->actingAs($admin)->deleteJson('/admin/users/'.$login->id)->assertOk();
        $this->actingAs($admin)->getJson("/portal/companies/{$company->uid}/members")
            ->assertOk()
            ->assertJsonCount(0, 'members')
            ->assertJsonPath('removed.0.email', 'travis@acme.test');

        $this->actingAs($admin)->postJson('/portal/admin/recycle-bin/empty')->assertOk();

        $member = CompanyMember::where('uuid', $uuid)->first();
        $this->assertNotNull($member, 'the membership record has to survive the purge');
        $this->assertNull($member->user_id);
        $this->assertSame('removed', $member->status);

        $this->actingAs($admin)->getJson("/portal/companies/{$company->uid}/members")
            ->assertOk()
            ->assertJsonCount(0, 'members');
    }

    /**
     * An accepted invitation has been used up — a resend starts a new one — so
     * it must not go on reporting itself as outstanding. A member whose login
     * has since been purged read as "Invite sent", offering to re-send a link
     * nobody was waiting on.
     */
    public function test_an_accepted_invitation_is_not_still_reported_as_sent(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'dana@acme.test', 'role' => 'member', 'invite' => true,
        ])->assertCreated()->json('member.id');

        $this->actingAs($admin)->getJson("/portal/companies/{$company->uid}/members")
            ->assertOk()
            ->assertJsonPath('members.0.inviteSent', true);

        Invitation::where('email', 'dana@acme.test')->update([
            'status' => Invitation::STATUS_ACCEPTED,
            'accepted_at' => now(),
        ]);

        $this->actingAs($admin)->getJson("/portal/companies/{$company->uid}/members")
            ->assertOk()
            ->assertJsonPath('members.0.id', $uuid)
            ->assertJsonPath('members.0.inviteSent', false);
    }

    public function test_a_failed_member_invite_is_reported_to_staff(): void
    {
        $admin = $this->admin();
        $company = $this->company();
        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'dana@acme.test', 'role' => 'member',
        ])->json('member.id');

        Mail::shouldReceive('to->sendNow')->andThrow(new \RuntimeException('SMTP refused the connection'));

        $response = $this->actingAs($admin)
            ->postJson("/portal/companies/{$company->uid}/members/{$uuid}/invite")
            ->assertStatus(422);

        $this->assertStringContainsString('SMTP refused', (string) $response->json('message'));
    }

    public function test_accepting_a_company_invitation_activates_the_membership(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed', 'email' => 'dana@acme.test', 'role' => 'signatory', 'invite' => true,
        ]);

        $token = null;
        Mail::assertSent(Postcard::class, function (Postcard $m) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $m->payload['button']['url'] ?? '', $x)) {
                $token = $x[1];
            }

            return true;
        });

        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('Acme Group')
            ->assertDontSee('Access to Acme Group');

        $this->post("/invite/{$token}", [
            'first_name' => 'Dana', 'last_name' => 'Reed', 'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ])->assertRedirect('/');

        $member = CompanyMember::first();
        $this->assertSame('active', $member->status);
        $this->assertNotNull($member->user_id);
        $this->assertSame('dana@acme.test', $member->user->email);
        $this->assertSame('Dana Reed', $member->user->name);
        $this->assertSame('Dana Reed', $member->name);
    }

    public function test_adding_an_address_that_already_has_an_account_links_it(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $existing = $this->staff('Client', ['email' => 'dana@acme.test']);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed', 'email' => 'dana@acme.test', 'role' => 'primary',
        ])->assertCreated()
            ->assertJsonPath('member.hasAccount', true)
            ->assertJsonPath('member.status', 'active');

        $this->assertSame($existing->id, CompanyMember::first()->user_id);
        $this->assertSame(1, User::where('email', 'dana@acme.test')->count());
    }

    public function test_only_one_member_is_the_primary_contact(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        foreach (['a@acme.test', 'b@acme.test'] as $email) {
            $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
                'email' => $email, 'role' => 'primary', 'primary' => true,
            ])->assertCreated();
        }

        $this->assertSame(1, CompanyMember::where('company_id', $company->id)->where('is_primary', true)->count());
    }

    public function test_re_adding_a_removed_member_with_an_account_revives_their_row(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        [$user, $member] = $this->memberWithAccount($company, 'viewer', $admin);

        $this->actingAs($admin)->deleteJson("/portal/companies/{$company->uid}/members/{$member->uuid}")->assertOk();
        $this->assertSame('removed', $member->fresh()->status);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => $user->email, 'role' => 'finance',
        ])->assertCreated();

        $this->assertSame(1, CompanyMember::count());
        $this->assertSame('finance', CompanyMember::first()->role);
    }

    public function test_removing_an_invited_member_wipes_them_clean(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Old Name', 'email' => 'dana@acme.test', 'role' => 'viewer', 'invite' => true,
        ])->json('member.id');

        $this->actingAs($admin)->deleteJson("/portal/companies/{$company->uid}/members/{$uuid}")->assertOk();

        // Nothing left to revive: no member row, and the invitation cancelled.
        $this->assertSame(0, CompanyMember::count());
        $this->assertSame(Invitation::STATUS_CANCELLED, Invitation::first()->status);

        // Re-entering the address starts from what is typed now, not history.
        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Travis Thomas', 'email' => 'dana@acme.test', 'role' => 'member', 'invite' => true,
        ])->assertCreated();

        $this->assertSame(1, CompanyMember::count());
        $this->assertSame('Travis Thomas', CompanyMember::first()->name);
    }

    // ------------------------------------------- role permissions (Phase 14)

    public function test_each_role_gets_the_permissions_it_should_and_no_more(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        [$finance, $financeMember] = $this->memberWithAccount($company, 'finance', $admin);
        [$signatory, $signatoryMember] = $this->memberWithAccount($company, 'signatory', $admin);
        [$viewer, $viewerMember] = $this->memberWithAccount($company, 'viewer', $admin);
        [$primary, $primaryMember] = $this->memberWithAccount($company, 'primary', $admin);

        // Finance sees invoices, but not contracts and not internal bookings.
        $this->assertTrue($financeMember->can('can_view_invoices'));
        $this->assertFalse($financeMember->can('can_view_contracts'));
        $this->assertFalse($financeMember->can('can_view_bookings'));

        // A signatory can sign; finance cannot.
        $this->assertTrue($signatoryMember->can('can_sign_contracts'));
        $this->assertFalse($financeMember->can('can_sign_contracts'));

        // A viewer can look and nothing else.
        $this->assertTrue($viewerMember->can('can_view_files'));
        $this->assertFalse($viewerMember->can('can_upload_files'));
        $this->assertFalse($viewerMember->can('can_view_invoices'));

        // The primary contact has the run of the place — but that is a role
        // decision, not an accident of being a member.
        $this->assertTrue($primaryMember->can('can_manage_bookings'));
        $this->assertTrue($primaryMember->can('can_invite_others'));

        // And the resolver agrees with the rows.
        $this->assertTrue(CompanyAccess::can($finance, $company, 'can_view_invoices'));
        $this->assertFalse(CompanyAccess::can($viewer, $company, 'can_view_invoices'));
    }

    public function test_a_permission_can_be_granted_beyond_the_role_default(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'dana@acme.test', 'role' => 'finance',
            'abilities' => ['can_sign_contracts' => true],
        ])->assertCreated()->json('member.id');

        $member = CompanyMember::where('uuid', $uuid)->first();
        $this->assertTrue((bool) $member->can_sign_contracts);
        $this->assertTrue((bool) $member->can_view_invoices, 'the role default was lost');
    }

    public function test_a_removed_member_holds_nothing(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        [$user, $member] = $this->memberWithAccount($company, 'primary', $admin);

        $this->assertTrue(CompanyAccess::can($user, $company, 'can_view_invoices'));

        CompanyMembers::remove($company, $member, $admin);

        $this->assertFalse(CompanyAccess::can($user->fresh(), $company, 'can_view_invoices'));
        $this->assertNull(CompanyAccess::memberOf($user->fresh(), $company));
    }

    public function test_invoice_recipients_are_the_members_who_may_see_them(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        [$finance] = $this->memberWithAccount($company, 'finance', $admin);
        $this->memberWithAccount($company, 'viewer', $admin);

        $recipients = CompanyAccess::recipientsFor($company, 'can_view_invoices');

        $this->assertSame([$finance->id], $recipients);
    }

    // -------------------------------------------- company files (Phase 15)

    private function companyFolder(User $owner): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Acme Group',
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
    }

    private function shareWithCompany(User $admin, Folder $folder, Company $company, string $role = 'downloader', ?string $companyRole = null): void
    {
        $this->actingAs($admin)->postJson('/portal/files/shares', [
            'type' => 'folder', 'id' => $folder->uuid, 'mode' => 'company',
            'role' => $role, 'companyUid' => $company->uid, 'companyRole' => $companyRole,
        ])->assertCreated();
    }

    public function test_one_company_share_covers_every_member(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $folder = $this->companyFolder($admin);

        [$finance] = $this->memberWithAccount($company, 'finance', $admin);
        [$viewer] = $this->memberWithAccount($company, 'viewer', $admin);
        $outsider = $this->staff('Client', ['email' => 'nobody@example.test']);

        $this->shareWithCompany($admin, $folder, $company);

        $this->assertNotNull(FileAccess::folderRole($finance->fresh(), $folder));
        $this->assertNotNull(FileAccess::folderRole($viewer->fresh(), $folder));
        // Someone who is not at the company gets nothing.
        $this->assertNull(FileAccess::folderRole($outsider->fresh(), $folder));

        // One row, not one per person.
        $this->assertSame(1, Share::where('kind', 'company')->count());
    }

    public function test_a_new_member_inherits_access_and_a_removed_one_loses_it(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $folder = $this->companyFolder($admin);
        $this->shareWithCompany($admin, $folder, $company);

        // Added *after* the share was made.
        [$latecomer, $member] = $this->memberWithAccount($company, 'primary', $admin);
        $this->assertNotNull(
            FileAccess::folderRole($latecomer->fresh(), $folder),
            'a member added after the share did not inherit access'
        );

        CompanyMembers::remove($company, $member, $admin);
        $this->assertNull(
            FileAccess::folderRole($latecomer->fresh(), $folder),
            'a removed member kept their access'
        );
    }

    public function test_a_share_can_be_narrowed_to_one_company_role(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $folder = $this->companyFolder($admin);

        [$finance] = $this->memberWithAccount($company, 'finance', $admin);
        [$viewer] = $this->memberWithAccount($company, 'viewer', $admin);

        $this->shareWithCompany($admin, $folder, $company, 'downloader', CompanyRoles::FINANCE);

        $this->assertNotNull(FileAccess::folderRole($finance->fresh(), $folder));
        $this->assertNull(
            FileAccess::folderRole($viewer->fresh(), $folder),
            'a role-scoped share leaked to the wrong role'
        );
    }

    public function test_a_company_share_still_respects_the_members_own_permissions(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $folder = $this->companyFolder($admin);

        [$viewer] = $this->memberWithAccount($company, 'viewer', $admin);

        // Shared as editor, but a viewer may not upload.
        $this->shareWithCompany($admin, $folder, $company, 'editor');

        $role = FileAccess::folderRole($viewer->fresh(), $folder);
        $this->assertSame('downloader', $role, 'a viewer was promoted by the share');
        $this->assertFalse(FileAccess::can($viewer->fresh(), 'upload', $folder));
    }

    public function test_manage_access_names_the_company_not_its_people(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $folder = $this->companyFolder($admin);
        $this->memberWithAccount($company, 'finance', $admin);
        $this->memberWithAccount($company, 'viewer', $admin);

        $this->shareWithCompany($admin, $folder, $company);

        $access = $this->actingAs($admin)
            ->getJson('/portal/files/shares?type=folder&id='.$folder->uuid)->assertOk()->json();

        $this->assertCount(1, $access['companies']);
        $this->assertSame('Everyone at Acme Group', $access['companies'][0]['company']['label']);
        // The individual members are not listed as people.
        $this->assertCount(0, $access['people']);
    }

    // ------------------------------- staff assigned to a company (Phase 16)

    private function clientUnder(Company $company, string $uid = 'acme-contact'): Client
    {
        return Client::create([
            'uid' => $uid, 'name' => ucfirst($uid), 'company_id' => $company->id,
            'initial' => 'A', 'initial_color' => 'blue', 'data' => [],
        ]);
    }

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

    public function test_the_reach_of_an_assignment_is_previewed_before_it_is_made(): void
    {
        $admin = $this->admin();
        $company = $this->company();
        $this->clientUnder($company, 'contact-one');
        $this->clientUnder($company, 'contact-two');

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff/preview", [
            'appliesToClients' => 'existing_future',
        ])->assertOk()
            ->assertJsonPath('preview.contactsCovered', 2)
            ->assertJsonPath('preview.includesFuture', true);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff/preview", [
            'appliesToClients' => 'company_only',
        ])->assertOk()
            ->assertJsonPath('preview.contactsCovered', 0)
            ->assertJsonPath('preview.includesFuture', false);
    }

    public function test_a_company_only_assignment_does_not_reach_the_contacts(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $company = $this->company();
        $client = $this->clientUnder($company);
        $folder = $this->clientFolder($client, $admin);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $emp->id, 'level' => 'editor', 'appliesToClients' => 'company_only',
        ])->assertOk()->assertJsonPath('applied.contactsCovered', 0);

        $this->assertNull(
            FileAccess::folderRole($emp->fresh(), $folder),
            'a company-only assignment reached a contact folder'
        );
    }

    public function test_an_assignment_over_existing_contacts_reaches_their_folders(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $company = $this->company();
        $client = $this->clientUnder($company);
        $folder = $this->clientFolder($client, $admin);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $emp->id, 'level' => 'editor', 'appliesToClients' => 'existing',
        ])->assertOk();

        $this->assertSame('editor', FileAccess::folderRole($emp->fresh(), $folder));
        $this->assertContains($folder->id, FileAccess::systemVisibleFolderIds($emp->fresh()));
    }

    public function test_only_a_future_scoped_assignment_covers_contacts_added_later(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $pinned = $this->staff();
        $future = $this->staff();
        $company = $this->company();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $pinned->id, 'level' => 'editor', 'appliesToClients' => 'existing',
        ])->assertOk();
        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $future->id, 'level' => 'editor', 'appliesToClients' => 'existing_future',
        ])->assertOk();

        // A contact added afterwards.
        $this->travel(1)->minutes();
        $newClient = $this->clientUnder($company, 'late-contact');
        $folder = $this->clientFolder($newClient, $admin);

        $this->assertNull(
            FileAccess::folderRole($pinned->fresh(), $folder),
            'an "existing" assignment picked up a contact added later'
        );
        $this->assertSame('editor', FileAccess::folderRole($future->fresh(), $folder));
    }

    public function test_ending_a_company_assignment_removes_the_inherited_access(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $company = $this->company();
        $client = $this->clientUnder($company);
        $folder = $this->clientFolder($client, $admin);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $emp->id, 'level' => 'editor', 'appliesToClients' => 'existing_future',
        ])->assertOk();
        $this->assertSame('editor', FileAccess::folderRole($emp->fresh(), $folder));

        $this->actingAs($admin)
            ->deleteJson("/portal/companies/{$company->uid}/staff/{$emp->id}")->assertOk();

        $this->assertNull(FileAccess::folderRole($emp->fresh(), $folder));
        // Kept as history.
        $this->assertSame('ended', CompanyStaffAssignment::first()->status);
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'company.staff_removed']);
    }

    public function test_a_non_admin_staff_member_cannot_assign_staff_to_a_company(): void
    {
        Mail::fake();
        $officer = $this->staff('Reviewing Officer');
        $company = $this->company();

        $this->actingAs($officer)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $this->staff()->id, 'level' => 'editor',
        ])->assertForbidden();
    }

    public function test_a_client_account_cannot_be_assigned_as_company_staff(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/staff", [
            'userId' => $this->staff('Client')->id, 'level' => 'editor',
        ])->assertStatus(422);
    }

    public function test_a_company_member_cannot_reach_another_companys_files(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $acme = $this->company();
        $other = $this->company(['uid' => 'wayne-co', 'name' => 'Wayne Co']);
        $folder = $this->companyFolder($admin);

        [$acmePerson] = $this->memberWithAccount($acme, 'primary', $admin);
        $this->shareWithCompany($admin, $folder, $other);

        $this->assertNull(FileAccess::folderRole($acmePerson->fresh(), $folder));
    }
}
