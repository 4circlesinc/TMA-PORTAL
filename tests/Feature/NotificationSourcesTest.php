<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Real actions across the portal must raise the right notifications and audit
 * entries (§13). These drive the actual HTTP endpoints so the controller wiring
 * — not just the services — is exercised.
 */
class NotificationSourcesTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $type = 'Administrator', array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved', 'account_type' => $type,
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ], $o));
    }

    private function clientPayload(array $o = []): array
    {
        return array_merge([
            'uid' => 'acme-co', 'name' => 'Acme Co', 'initial' => 'A', 'initialColor' => 'blue',
            'profile' => ['work' => ['company' => 'Acme'], 'emails' => [], 'phones' => [], 'addresses' => [], 'importantDates' => []],
        ], $o);
    }

    public function test_creating_a_client_logs_activity_and_notifies_other_admins(): void
    {
        $creator = $this->staff();
        $otherAdmin = $this->staff();
        $employee = $this->staff('Employee');

        $this->actingAs($creator)->postJson('/portal/clients', $this->clientPayload())->assertOk();

        // Audit entry by the creator.
        $log = ActivityLog::where('activity_type', 'client.created')->first();
        $this->assertNotNull($log);
        $this->assertSame($creator->id, $log->actor_id);
        $this->assertSame('clients', $log->module);

        // The other admin is notified; the creator is not (self); the employee is not (admins only).
        $this->assertSame(1, Notification::where('user_id', $otherAdmin->id)->where('type', 'client.created')->count());
        $this->assertSame(0, Notification::where('user_id', $creator->id)->count());
        $this->assertSame(0, Notification::where('user_id', $employee->id)->count());
    }

    public function test_assigning_a_client_notifies_the_assigned_staff_once(): void
    {
        $admin = $this->staff();
        $employee = $this->staff('Employee');
        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload())->assertOk();
        $client = Client::where('uid', 'acme-co')->firstOrFail();

        $level = array_key_first(ClientAssignment::LEVELS);
        $assign = fn () => $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $employee->id, 'level' => $level,
        ]);

        $assign()->assertOk();
        $this->assertSame(1, Notification::where('user_id', $employee->id)->where('type', 'client.assigned')->count());
        $n = Notification::where('user_id', $employee->id)->where('type', 'client.assigned')->first();
        $this->assertSame($admin->id, $n->actor_id);
        $this->assertStringContainsString('/clients?client=', $n->action_url);

        // Re-assigning (updateOrCreate, not recently created) must not re-notify.
        $assign()->assertOk();
        $this->assertSame(1, Notification::where('user_id', $employee->id)->where('type', 'client.assigned')->count());
    }

    public function test_deleting_a_client_is_audited(): void
    {
        $admin = $this->staff();
        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload())->assertOk();

        $this->actingAs($admin)->deleteJson('/portal/clients/acme-co')->assertOk();

        $this->assertSame(1, ActivityLog::where('activity_type', 'client.deleted')->count());
    }
}
