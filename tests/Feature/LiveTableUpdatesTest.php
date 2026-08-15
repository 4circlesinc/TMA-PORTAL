<?php

namespace Tests\Feature;

use App\Events\PortalDataChanged;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Realtime\Live;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * The tables update themselves.
 *
 * Every view that lists something registers a refresh with TMALive and waits
 * for a signal; before this the listeners existed and almost nothing emitted,
 * so a row added by one person sat invisible on everybody else's screen until
 * they reloaded. These pin the emitting half: a write signals, a read never
 * does (a signal on read would have every open tab refetching in a loop).
 *
 * Signals carry no rows — each viewer refetches through their own scoped
 * endpoint — so a signal can never show somebody a record they may not see.
 */
class LiveTableUpdatesTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @return list<string> the resources signalled while running $work */
    private function resourcesSignalled(callable $work): array
    {
        Event::fake([PortalDataChanged::class]);

        $work();
        // Signals are collected per request and sent on terminate; the test
        // kernel does not terminate, so flush by hand.
        Live::flush();

        $seen = [];
        foreach (Event::dispatched(PortalDataChanged::class) as $dispatched) {
            $seen[] = $dispatched[0]->resource;
        }

        return array_values(array_unique($seen));
    }

    public function test_creating_a_client_signals_the_directory(): void
    {
        $admin = $this->admin();

        $signals = $this->resourcesSignalled(function () use ($admin) {
            $this->actingAs($admin)->postJson('/portal/clients', [
                'uid' => 'live-one',
                'name' => 'Live One',
                'profile' => ['firstName' => 'Live', 'lastName' => 'One'],
            ])->assertSuccessful();
        });

        $this->assertContains(Live::CLIENTS, $signals);
    }

    public function test_creating_a_service_provider_signals_both_lists(): void
    {
        $admin = $this->admin();

        $signals = $this->resourcesSignalled(function () use ($admin) {
            $this->actingAs($admin)->postJson('/portal/companies', ['name' => 'Live Co'])
                ->assertCreated();
        });

        // The hub draws providers and clients in one table, so it listens on
        // CLIENTS; COMPANIES is the honest name for what changed.
        $this->assertContains(Live::COMPANIES, $signals);
        $this->assertContains(Live::CLIENTS, $signals);
    }

    public function test_assigning_staff_signals_the_assignee_too(): void
    {
        $admin = $this->admin();
        $officer = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
        ]);
        $client = Client::create(['uid' => 'live-client', 'name' => 'Live Client', 'data' => []]);

        Event::fake([PortalDataChanged::class]);

        $this->actingAs($admin)->postJson('/portal/clients/'.$client->uid.'/assignments', [
            'userId' => $officer->id, 'level' => 'editor',
        ])->assertSuccessful();
        Live::flush();

        // The assignment is what puts the client in that person's directory,
        // so their own tabs have to hear about it — not just the staff room.
        $reachedOfficer = false;
        foreach (Event::dispatched(PortalDataChanged::class) as $dispatched) {
            $event = $dispatched[0];
            foreach ($event->broadcastOn() as $channel) {
                if (str_contains((string) $channel->name, (string) $officer->id)) {
                    $reachedOfficer = true;
                }
            }
        }

        $this->assertTrue($reachedOfficer, 'the assignee should be signalled');
    }

    public function test_account_changes_signal_the_users_table(): void
    {
        $admin = $this->admin();
        $target = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::EMPLOYEE,
            'email_verified_at' => now(),
            'first_name' => 'Live', 'last_name' => 'Target',
        ]);

        $signals = $this->resourcesSignalled(function () use ($admin, $target) {
            $this->actingAs($admin)->patchJson('/admin/users/'.$target->id, [
                'first_name' => 'Live',
                'last_name' => 'Target',
                'email' => $target->email,
                'account_type' => Role::COMPLIANCE_OFFICER,
            ])->assertSuccessful();
        });

        $this->assertContains(Live::USERS, $signals);
    }

    public function test_reading_a_list_signals_nothing(): void
    {
        $admin = $this->admin();
        Client::create(['uid' => 'quiet-one', 'name' => 'Quiet One', 'data' => []]);

        $signals = $this->resourcesSignalled(function () use ($admin) {
            $this->actingAs($admin)->getJson('/portal/clients')->assertOk();
            $this->actingAs($admin)->getJson('/portal/companies')->assertOk();
            $this->actingAs($admin)->getJson('/admin/users')->assertOk();
        });

        $this->assertSame([], $signals);
    }
}
