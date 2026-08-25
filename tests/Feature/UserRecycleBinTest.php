<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Deleting an account from Browse employees used to erase the row outright.
 * It now soft-deletes into the admin Recycle Bin, alongside files, folders and
 * clients: recoverable until an administrator purges it on purpose.
 */
class UserRecycleBinTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Administrator', array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    public function test_deleting_an_account_moves_it_to_the_recycle_bin(): void
    {
        $admin = $this->user('Administrator');
        $victim = $this->user('Employee', ['name' => 'Selina Kyle', 'email' => 'selina@firm.test']);

        $this->actingAs($admin)->deleteJson("/admin/users/{$victim->id}")->assertOk();

        // The row survives, so nothing keyed to the account cascaded away.
        $this->assertSoftDeleted('users', ['id' => $victim->id]);
        $this->assertNotNull($victim->fresh()?->deleted_at ?? User::withTrashed()->find($victim->id)->deleted_at);
        $this->assertSame($admin->id, User::withTrashed()->find($victim->id)->deleted_by);

        // And it is gone from every screen that lists accounts.
        $this->actingAs($admin)->getJson('/admin/users')
            ->assertOk()
            ->assertJsonMissing(['email' => 'selina@firm.test']);

        $this->actingAs($admin)->getJson('/portal/admin/recycle-bin?kind=user')
            ->assertOk()
            ->assertJsonPath('items.0.kind', 'user')
            ->assertJsonPath('items.0.id', (string) $victim->id)
            ->assertJsonPath('items.0.name', 'Selina Kyle')
            ->assertJsonPath('items.0.deletedBy.id', $admin->id);
    }

    public function test_a_deleted_account_cannot_sign_in(): void
    {
        $admin = $this->user('Administrator');
        $victim = $this->user('Employee', ['email' => 'gone@firm.test']);

        $this->actingAs($admin)->deleteJson("/admin/users/{$victim->id}")->assertOk();

        // Drop the acting admin's session, or the guest middleware on the login
        // route bounces the request before credentials are ever checked.
        $this->app['auth']->logout();
        $this->flushSession();

        // The soft-delete scope covers the query the auth guard runs, so the
        // credentials no longer resolve to anybody.
        $this->post('/auth/login', ['email' => 'gone@firm.test', 'password' => 'password'])
            ->assertSessionHasErrors();
        $this->assertGuest();
    }

    public function test_restoring_brings_the_account_back(): void
    {
        $admin = $this->user('Administrator');
        $victim = $this->user('Employee', ['email' => 'back@firm.test']);

        $this->actingAs($admin)->deleteJson("/admin/users/{$victim->id}")->assertOk();
        $this->actingAs($admin)->postJson("/portal/admin/recycle-bin/user/{$victim->id}/restore")->assertOk();

        $this->assertNotSoftDeleted('users', ['id' => $victim->id]);
        $this->assertNull(User::find($victim->id)->deleted_by);
        $this->actingAs($admin)->getJson('/admin/users')
            ->assertOk()
            ->assertJsonFragment(['email' => 'back@firm.test']);
    }

    public function test_purging_erases_the_account_for_good(): void
    {
        $admin = $this->user('Administrator');
        $victim = $this->user('Employee');

        $this->actingAs($admin)->deleteJson("/admin/users/{$victim->id}")->assertOk();
        $this->actingAs($admin)->deleteJson("/portal/admin/recycle-bin/user/{$victim->id}")->assertOk();

        $this->assertDatabaseMissing('users', ['id' => $victim->id]);
    }

    public function test_delete_settles_live_access_and_restore_does_not_hand_it_back(): void
    {
        $admin = $this->user('Administrator');
        $staff = $this->user('Employee');
        $client = Client::create(['uid' => 'acme', 'name' => 'Acme', 'data' => []]);

        $assignment = ClientAssignment::create([
            'client_id' => $client->id,
            'user_id' => $staff->id,
            'assigned_by' => $admin->id,
            'level' => 'editor',
            'status' => ClientAssignment::STATUS_ACTIVE,
        ]);

        $this->actingAs($admin)->deleteJson("/admin/users/{$staff->id}")->assertOk();
        $this->assertSame(ClientAssignment::STATUS_ENDED, $assignment->fresh()->status);

        // Coming back restores the person, not their reach: re-assigning is a
        // deliberate act, the same as after a suspension.
        $this->actingAs($admin)->postJson("/portal/admin/recycle-bin/user/{$staff->id}/restore")->assertOk();
        $this->assertSame(ClientAssignment::STATUS_ENDED, $assignment->fresh()->status);
    }

    public function test_a_bulk_delete_lands_every_account_in_the_bin(): void
    {
        $admin = $this->user('Administrator');
        $one = $this->user('Employee');
        $two = $this->user('Employee');

        $this->actingAs($admin)
            ->postJson('/admin/users/bulk-delete', ['ids' => [$one->id, $two->id, $admin->id]])
            ->assertOk()
            ->assertJsonPath('deleted', 2)
            ->assertJsonPath('skippedSelf', true);

        $this->assertSoftDeleted('users', ['id' => $one->id]);
        $this->assertSoftDeleted('users', ['id' => $two->id]);
        $this->assertNotSoftDeleted('users', ['id' => $admin->id]);
    }

    /**
     * The unique index on users.email counts soft-deleted rows, so an account
     * in the bin keeps its address reserved. That is what makes restoring safe
     * — but it also means the address cannot be handed out again until the
     * account is purged.
     */
    public function test_an_account_in_the_bin_keeps_its_email_reserved(): void
    {
        $admin = $this->user('Administrator');
        $victim = $this->user('Employee', ['email' => 'shared@firm.test']);

        $this->actingAs($admin)->deleteJson("/admin/users/{$victim->id}")->assertOk();

        $this->actingAs($admin)->postJson('/admin/users', [
            'name' => 'Someone Else',
            'email' => 'shared@firm.test',
            'account_type' => 'Employee',
        ])->assertStatus(422);

        $this->actingAs($admin)->deleteJson("/portal/admin/recycle-bin/user/{$victim->id}")->assertOk();

        // Once purged the address is free again.
        $this->assertFalse(User::withTrashed()->where('email', 'shared@firm.test')->exists());
    }

    public function test_only_administrators_reach_the_bin(): void
    {
        $officer = $this->user('Reviewing Officer');

        $this->actingAs($officer)->getJson('/portal/admin/recycle-bin?kind=user')->assertForbidden();
    }

    public function test_deleting_an_account_hides_its_email_from_the_client_contact_column(): void
    {
        $admin = $this->user('Administrator');
        $login = $this->user('Client', [
            'name' => 'I Graphix',
            'email' => 'igraphixmktgco@gmail.com',
        ]);

        Client::create([
            'uid' => 'igraphix',
            'name' => 'I Graphix',
            'email' => 'igraphixmktgco@gmail.com',
            'user_id' => $login->id,
            'data' => [],
        ]);

        $this->actingAs($admin)->getJson('/portal/clients')
            ->assertOk()
            ->assertJsonPath('clients.0.contact', 'igraphixmktgco@gmail.com');

        $this->actingAs($admin)->deleteJson("/admin/users/{$login->id}")->assertOk();

        $this->actingAs($admin)->getJson('/portal/clients')
            ->assertOk()
            ->assertJsonPath('clients.0.contact', null)
            ->assertJsonMissing(['contact' => 'igraphixmktgco@gmail.com']);
    }
}
