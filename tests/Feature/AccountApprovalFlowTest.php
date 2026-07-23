<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The account approval flow (§16–§19): a new registration alerts the admins,
 * approving or denying notifies the user and audits the action, and the
 * outstanding approval notification clears so it can't be processed twice.
 */
class AccountApprovalFlowTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
    }

    private function pending(): User
    {
        return User::factory()->create(['status' => 'pending', 'account_type' => 'Client', 'name' => 'Newbie Jones']);
    }

    public function test_registration_alerts_admins_and_audits(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();

        event(new Registered($newbie));

        $n = Notification::where('user_id', $admin->id)->where('type', 'account.pending')->first();
        $this->assertNotNull($n);
        $this->assertSame(Notification::LEVEL_APPROVAL, $n->level);
        $this->assertSame('Review Account', $n->action_label);
        $this->assertSame($newbie->id, $n->actor_id);
        $this->assertTrue($n->requiresAction());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.registered')->count());
    }

    public function test_approving_notifies_the_user_clears_the_alert_and_is_audited(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();
        event(new Registered($newbie));

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => 'Employee'])
            ->assertOk();

        $newbie->refresh();
        $this->assertSame('approved', $newbie->status);
        $this->assertSame('Employee', $newbie->account_type);

        // The user is told, and it's audited.
        $this->assertSame(1, Notification::where('user_id', $newbie->id)->where('type', 'account.approved')->count());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.approved')->count());

        // The admin's approval alert is now completed (no longer action-required).
        $alert = Notification::where('user_id', $admin->id)->where('type', 'account.pending')->first();
        $this->assertNotNull($alert->completed_at);
        $this->assertFalse($alert->requiresAction());

        // Pending count is now zero.
        $this->actingAs($admin)->getJson('/admin/users/pending-count')->assertJsonPath('count', 0);
    }

    public function test_a_pending_account_cannot_be_approved_twice(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => 'Employee'])->assertOk();
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => 'Employee'])->assertStatus(422);
    }

    public function test_denying_records_a_reason_notifies_and_clears_the_alert(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();
        event(new Registered($newbie));

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/deny", ['reason' => 'Unverified organisation'])
            ->assertOk();

        $newbie->refresh();
        $this->assertSame('suspended', $newbie->status);
        $this->assertSame('Unverified organisation', $newbie->admin_note);

        $this->assertSame(1, Notification::where('user_id', $newbie->id)->where('type', 'account.denied')->count());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.denied')->count());

        $alert = Notification::where('user_id', $admin->id)->where('type', 'account.pending')->first();
        $this->assertNotNull($alert->completed_at);

        // A denied (non-pending) account can't be denied again.
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/deny")->assertStatus(422);
    }

    public function test_non_admins_cannot_approve_or_deny(): void
    {
        $employee = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Employee',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
        $newbie = $this->pending();

        $this->actingAs($employee)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => 'Employee'])->assertStatus(403);
        $this->actingAs($employee)->postJson("/admin/users/{$newbie->id}/deny")->assertStatus(403);
    }
}
