<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationsApiTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function seedNotifications(User $recipient, User $actor, int $n = 3): void
    {
        for ($i = 0; $i < $n; $i++) {
            Notifier::send([
                'user' => $recipient,
                'actor' => $actor,
                'type' => 'file.shared',
                'title' => "Shared file {$i}",
            ]);
        }
    }

    public function test_index_returns_only_the_callers_notifications(): void
    {
        $me = $this->user();
        $other = $this->user();
        $actor = $this->user();

        $this->seedNotifications($me, $actor, 3);
        $this->seedNotifications($other, $actor, 2);

        $res = $this->actingAs($me)->getJson('/portal/notifications');
        $res->assertOk();
        $res->assertJsonCount(3, 'items');
        $res->assertJsonPath('unread', 3);
        $this->assertNotNull($res->json('items.0.actor.name'));
    }

    public function test_count_read_unread_and_read_all(): void
    {
        $me = $this->user();
        $this->seedNotifications($me, $this->user(), 3);

        $uid = $this->actingAs($me)->getJson('/portal/notifications')->json('items.0.id');

        $this->actingAs($me)->getJson('/portal/notifications/count')->assertJsonPath('unread', 3);

        $this->actingAs($me)->postJson("/portal/notifications/{$uid}/read")
            ->assertOk()->assertJsonPath('unread', 2)->assertJsonPath('item.read', true);

        $this->actingAs($me)->postJson("/portal/notifications/{$uid}/unread")
            ->assertOk()->assertJsonPath('unread', 3);

        $this->actingAs($me)->postJson('/portal/notifications/read-all')
            ->assertOk()->assertJsonPath('unread', 0);
    }

    public function test_a_user_cannot_touch_another_users_notification(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->seedNotifications($other, $this->user(), 1);

        $foreignUid = \App\Models\Notification::where('user_id', $other->id)->value('uid');

        $this->actingAs($me)->postJson("/portal/notifications/{$foreignUid}/read")->assertNotFound();
        $this->actingAs($me)->deleteJson("/portal/notifications/{$foreignUid}")->assertNotFound();
    }

    public function test_preferences_round_trip_and_lock_security(): void
    {
        $me = $this->user();

        $this->actingAs($me)->putJson('/portal/notifications/preferences', [
            'preferences' => [
                'files' => ['portal' => false],
                'security' => ['portal' => false], // must be ignored
            ],
        ])->assertOk()
            ->assertJsonPath('preferences.files.portal', false)
            ->assertJsonPath('preferences.security.portal', true);
    }

    public function test_activity_admin_sees_all_but_employee_sees_only_their_own(): void
    {
        $admin = $this->user(['account_type' => 'Administrator']);
        $alice = $this->user();
        $bob = $this->user();

        ActivityLogger::log(['actor' => $alice, 'type' => 'client.created', 'description' => 'Alice made a client']);
        ActivityLogger::log(['actor' => $bob, 'type' => 'file.deleted', 'description' => 'Bob deleted a file']);
        ActivityLogger::log(['type' => 'system.sync_completed', 'description' => 'System synced email']);

        // Admin sees everything and gets sensitive fields serialised.
        $adminRes = $this->actingAs($admin)->getJson('/portal/activity');
        $adminRes->assertOk()->assertJsonCount(3, 'items')->assertJsonPath('isAdmin', true);

        // Alice sees only her own action.
        $aliceRes = $this->actingAs($alice)->getJson('/portal/activity');
        $aliceRes->assertOk()->assertJsonCount(1, 'items')->assertJsonPath('items.0.description', 'Alice made a client');
        $aliceRes->assertJsonPath('items.0.ip', null); // non-admins never receive IP
    }

    public function test_activity_search_and_module_filter(): void
    {
        $admin = $this->user(['account_type' => 'Administrator']);
        ActivityLogger::log(['actor' => $admin, 'type' => 'client.created', 'description' => 'Created Wayne Enterprises']);
        ActivityLogger::log(['actor' => $admin, 'type' => 'file.deleted', 'description' => 'Deleted a spreadsheet']);

        $this->actingAs($admin)->getJson('/portal/activity?search=Wayne')
            ->assertOk()->assertJsonCount(1, 'items');
        $this->actingAs($admin)->getJson('/portal/activity?module=files')
            ->assertOk()->assertJsonCount(1, 'items')->assertJsonPath('items.0.module', 'files');
    }

    public function test_activity_badge_counts_new_since_seen(): void
    {
        $admin = $this->user(['account_type' => 'Administrator']);
        $bob = $this->user();

        ActivityLogger::log(['actor' => $bob, 'type' => 'file.deleted', 'description' => 'Bob deleted a file']);
        $this->actingAs($admin)->getJson('/portal/activity/count')->assertJsonPath('new', 1);

        $this->actingAs($admin)->postJson('/portal/activity/seen')->assertOk();
        // A short beat so the new row is strictly after the seen baseline.
        $this->travel(2)->seconds();
        ActivityLogger::log(['actor' => $bob, 'type' => 'file.uploaded', 'description' => 'Bob uploaded a file']);

        $this->actingAs($admin)->getJson('/portal/activity/count')->assertJsonPath('new', 1);
    }
}
