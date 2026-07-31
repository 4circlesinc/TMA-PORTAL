<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\Client;
use App\Models\Contact;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The People section: Manage users, Browse employees, Browse client contacts,
 * Browse prospects, the address books and Resend welcome emails.
 */
class PeopleTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type, array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function signedInOnce(User $user): User
    {
        AuthEvent::create([
            'user_id' => $user->id,
            'event' => 'login',
            'ip' => '127.0.0.1',
            'user_agent' => 'phpunit',
            'created_at' => now()->subDay(),
        ]);

        return $user;
    }

    /* ── who may read the section ─────────────────────────────────── */

    public function test_clients_cannot_read_the_people_section(): void
    {
        $client = $this->user('Client');

        $this->actingAs($client)->getJson('/portal/people/summary')->assertForbidden();
        $this->actingAs($client)->getJson('/portal/people/employees')->assertForbidden();
        $this->actingAs($client)->getJson('/portal/contacts?scope=shared')->assertForbidden();
    }

    public function test_the_people_pages_load_for_staff_and_404_for_clients(): void
    {
        $admin = $this->user('Administrator');
        $client = $this->user('Client');

        foreach (['/people', '/people/employees', '/people/distribution-groups', '/people/resend-welcome-emails'] as $path) {
            $this->actingAs($admin)->get($path)->assertOk();
        }

        // A page the account may not use does not exist as far as it is concerned.
        $this->actingAs($client)->get('/people')->assertNotFound();
        $this->actingAs($client)->get('/people/employees')->assertNotFound();
    }

    public function test_an_employee_may_browse_but_not_manage(): void
    {
        $employee = $this->user('Employee');

        $this->actingAs($employee)->getJson('/portal/people/employees')
            ->assertOk()
            ->assertJsonPath('capabilities.manageUsers', false);

        $this->actingAs($employee)->getJson('/portal/people/welcome-candidates')->assertForbidden();
        $this->actingAs($employee)->postJson('/portal/people/welcome', ['email' => 'x@example.com'])
            ->assertForbidden();
    }

    /* ── the lists ────────────────────────────────────────────────── */

    public function test_browse_employees_lists_staff_with_their_activation_state(): void
    {
        $admin = $this->signedInOnce($this->user('Administrator', ['name' => 'Ada Admin', 'last_name' => 'Admin']));
        $newHire = $this->user('Employee', ['name' => 'New Hire', 'last_name' => 'Hire', 'password_auto' => true]);
        $this->user('Client', ['name' => 'A Client']);

        $response = $this->actingAs($admin)->getJson('/portal/people/employees')->assertOk();

        $employees = collect($response->json('employees'));
        $this->assertCount(2, $employees, 'Client accounts do not belong on the employees screen.');

        $this->assertTrue($employees->firstWhere('id', $admin->id)['activated']);
        $this->assertFalse($employees->firstWhere('id', $newHire->id)['activated']);
        $this->assertNull($employees->firstWhere('id', $newHire->id)['lastLogin']);
    }

    public function test_browse_client_contacts_lists_client_accounts_with_their_company(): void
    {
        $admin = $this->user('Administrator');
        $clientUser = $this->user('Client', ['name' => 'Bruce Wayne', 'last_name' => 'Wayne']);

        Client::create([
            'uid' => 'bruce-wayne',
            'user_id' => $clientUser->id,
            'name' => 'Bruce Wayne',
            'company' => 'Wayne Enterprises',
            'email' => $clientUser->email,
            'data' => [],
        ]);

        $this->actingAs($admin)->getJson('/portal/people/client-contacts')
            ->assertOk()
            ->assertJsonPath('contacts.0.name', 'Bruce Wayne')
            ->assertJsonPath('contacts.0.company', 'Wayne Enterprises')
            ->assertJsonPath('contacts.0.clientUid', 'bruce-wayne');
    }

    public function test_prospects_are_pending_invites_and_accounts_that_never_signed_in(): void
    {
        $admin = $this->signedInOnce($this->user('Administrator'));
        $waiting = $this->user('Employee', ['password_auto' => true]);
        $this->signedInOnce($this->user('Employee'));

        $client = Client::create([
            'uid' => 'selina-kyle', 'name' => 'Selina Kyle',
            'email' => 'selina@example.com', 'data' => [],
        ]);
        $invitation = new Invitation(['client_id' => $client->id, 'email' => 'selina@example.com']);
        $invitation->issueToken();
        $invitation->forceFill([
            'type' => Invitation::TYPE_CLIENT,
            'status' => Invitation::STATUS_SENT,
            'expires_at' => now()->addDays(7),
            'last_sent_at' => now(),
        ])->save();

        $prospects = collect($this->actingAs($admin)->getJson('/portal/people/prospects')->assertOk()->json('prospects'));

        $this->assertEqualsCanonicalizing(
            ['invite:1', 'user:'.$waiting->id],
            $prospects->pluck('id')->all()
        );
        // Someone who has signed in is not a prospect, whatever their password state.
        $this->assertFalse($prospects->contains(fn ($p) => $p['email'] === $admin->email));
    }

    /* ── resend welcome emails ────────────────────────────────────── */

    public function test_an_account_that_never_set_a_password_gets_its_activation_link(): void
    {
        Mail::fake();
        $admin = $this->user('Administrator');
        $waiting = $this->user('Employee', ['password_auto' => true]);

        $this->actingAs($admin)->postJson('/portal/people/welcome', ['email' => $waiting->email])
            ->assertOk()
            ->assertJsonPath('kind', 'activation');
    }

    public function test_an_active_account_gets_the_welcome_postcard(): void
    {
        Mail::fake();
        $admin = $this->user('Administrator');
        $colleague = $this->signedInOnce($this->user('Employee', ['password_auto' => false]));

        $this->actingAs($admin)->postJson('/portal/people/welcome', [
            'email' => $colleague->email,
            'message' => 'Good to have you.',
            'copyToMe' => true,
        ])->assertOk()->assertJsonPath('kind', 'welcome');

        // One to them, one copy to the sender.
        Mail::assertQueuedCount(2);
    }

    public function test_the_welcome_screen_refuses_addresses_that_are_not_in_the_account(): void
    {
        Mail::fake();
        $admin = $this->user('Administrator');

        $this->actingAs($admin)->postJson('/portal/people/welcome', ['email' => 'stranger@example.com'])
            ->assertStatus(422);

        Mail::assertNothingQueued();
    }

    public function test_a_prospect_invitation_can_be_cancelled_and_an_unused_account_removed(): void
    {
        $admin = $this->user('Administrator');
        $client = Client::create([
            'uid' => 'selina-kyle', 'name' => 'Selina Kyle',
            'email' => 'selina@example.com', 'data' => [],
        ]);
        $invite = new Invitation(['client_id' => $client->id, 'email' => 'selina@example.com']);
        $invite->issueToken();
        $invite->forceFill([
            'type' => Invitation::TYPE_CLIENT,
            'status' => Invitation::STATUS_SENT,
            'expires_at' => now()->addDays(7),
        ])->save();
        $unused = $this->user('Employee', ['password_auto' => true]);
        $active = $this->signedInOnce($this->user('Employee', ['password_auto' => true]));

        $this->actingAs($admin)->deleteJson('/portal/people/prospects/invite:'.$invite->id)->assertOk();
        // Withdrawing cancels the invitation rather than erasing the record.
        $this->assertDatabaseHas('invitations', ['id' => $invite->id, 'status' => 'cancelled']);
        $this->assertNotNull($invite->fresh()->cancelled_at);

        $this->actingAs($admin)->deleteJson('/portal/people/prospects/user:'.$unused->id)->assertOk();
        $this->assertDatabaseMissing('users', ['id' => $unused->id]);

        // An account that has actually been used is not removed from here.
        $this->actingAs($admin)->deleteJson('/portal/people/prospects/user:'.$active->id)->assertStatus(422);
        $this->assertDatabaseHas('users', ['id' => $active->id]);
    }

    /* ── address books ────────────────────────────────────────────── */

    public function test_the_shared_book_is_account_wide_and_a_personal_book_is_private(): void
    {
        $mine = $this->user('Employee');
        $theirs = $this->user('Employee');

        $this->actingAs($mine)->postJson('/portal/contacts', [
            'scope' => 'shared', 'first_name' => 'Lucius', 'last_name' => 'Fox', 'email' => 'lucius@example.com',
        ])->assertCreated();

        $this->actingAs($mine)->postJson('/portal/contacts', [
            'scope' => 'personal', 'first_name' => 'Alfred', 'last_name' => 'Pennyworth',
        ])->assertCreated();

        // The colleague sees the shared entry…
        $this->actingAs($theirs)->getJson('/portal/contacts?scope=shared')
            ->assertOk()
            ->assertJsonCount(1, 'contacts')
            ->assertJsonPath('contacts.0.name', 'Lucius Fox');

        // …and none of the personal one.
        $this->actingAs($theirs)->getJson('/portal/contacts?scope=personal')
            ->assertOk()
            ->assertJsonCount(0, 'contacts');

        $this->actingAs($mine)->getJson('/portal/contacts?scope=personal')
            ->assertOk()
            ->assertJsonPath('contacts.0.name', 'Alfred Pennyworth');
    }

    public function test_someone_elses_personal_contact_cannot_be_edited_or_deleted(): void
    {
        $owner = $this->user('Employee');
        $other = $this->user('Administrator');

        $contact = Contact::create([
            'uuid' => (string) Str::uuid(),
            'scope' => 'personal',
            'owner_id' => $owner->id,
            'first_name' => 'Alfred',
            'created_by' => $owner->id,
        ]);

        // Not even an administrator: a personal book is private by definition.
        $this->actingAs($other)->patchJson('/portal/contacts/'.$contact->uuid, ['first_name' => 'Nope'])
            ->assertNotFound();
        $this->actingAs($other)->deleteJson('/portal/contacts/'.$contact->uuid)->assertNotFound();

        $this->actingAs($owner)->patchJson('/portal/contacts/'.$contact->uuid, ['first_name' => 'Alfred J.'])
            ->assertOk()
            ->assertJsonPath('contact.firstName', 'Alfred J.');
    }

    public function test_a_shared_entry_is_removed_by_its_author_but_not_by_another_employee(): void
    {
        $author = $this->user('Employee');
        $colleague = $this->user('Employee');

        $contact = Contact::create([
            'uuid' => (string) Str::uuid(),
            'scope' => 'shared',
            'first_name' => 'Lucius',
            'created_by' => $author->id,
        ]);

        // The list says so up front, so it never offers an action that 403s.
        $this->actingAs($colleague)->getJson('/portal/contacts?scope=shared')
            ->assertOk()
            ->assertJsonPath('contacts.0.canEdit', false);
        $this->actingAs($author)->getJson('/portal/contacts?scope=shared')
            ->assertJsonPath('contacts.0.canEdit', true);

        $this->actingAs($colleague)->deleteJson('/portal/contacts/'.$contact->uuid)->assertForbidden();
        $this->actingAs($author)->deleteJson('/portal/contacts/'.$contact->uuid)->assertOk();
        $this->assertSoftDeleted('contacts', ['id' => $contact->id]);
    }

    public function test_bulk_remove_only_touches_the_callers_own_book(): void
    {
        $owner = $this->user('Employee');
        $other = $this->user('Employee');

        $mine = Contact::create([
            'uuid' => (string) Str::uuid(), 'scope' => 'personal',
            'owner_id' => $owner->id, 'first_name' => 'Mine', 'created_by' => $owner->id,
        ]);
        $theirs = Contact::create([
            'uuid' => (string) Str::uuid(), 'scope' => 'personal',
            'owner_id' => $other->id, 'first_name' => 'Theirs', 'created_by' => $other->id,
        ]);

        $this->actingAs($owner)->postJson('/portal/contacts/bulk-delete', [
            'scope' => 'personal',
            'ids' => [$mine->uuid, $theirs->uuid],
        ])->assertOk()->assertJsonPath('deleted', 1);

        $this->assertSoftDeleted('contacts', ['id' => $mine->id]);
        $this->assertDatabaseHas('contacts', ['id' => $theirs->id, 'deleted_at' => null]);
    }

    /* ── manage users home ────────────────────────────────────────── */

    public function test_the_home_screen_counts_what_the_section_holds(): void
    {
        $admin = $this->signedInOnce($this->user('Administrator'));
        $this->user('Employee');
        $this->user('Client');
        $this->user('Client');

        Contact::create([
            'uuid' => (string) Str::uuid(), 'scope' => 'shared',
            'first_name' => 'Lucius', 'created_by' => $admin->id,
        ]);
        Contact::create([
            'uuid' => (string) Str::uuid(), 'scope' => 'personal',
            'owner_id' => $admin->id, 'first_name' => 'Alfred', 'created_by' => $admin->id,
        ]);

        $this->actingAs($admin)->getJson('/portal/people/summary')
            ->assertOk()
            ->assertJsonPath('counts.employees', 2)
            ->assertJsonPath('counts.clientContacts', 2)
            ->assertJsonPath('counts.sharedContacts', 1)
            ->assertJsonPath('counts.personalContacts', 1)
            ->assertJsonPath('capabilities.manageUsers', true);
    }
}
