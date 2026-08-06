<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settings → Privacy → History. The retention window is a promise that the
 * trail is cleared; these hold it to that.
 */
class PruneUserHistoryTest extends TestCase
{
    use RefreshDatabase;

    private function user(?int $days = null): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Employee',
            'preferences' => $days === null ? [] : ['historyDays' => $days],
        ]);
    }

    private function activity(User $user, int $daysAgo): ActivityLog
    {
        $row = ActivityLog::create([
            'uid' => (string) Str::uuid(),
            'actor_id' => $user->id,
            'activity_type' => 'security.login',
            'module' => 'account',
            'action' => 'login',
            'description' => 'signed in',
        ]);
        $row->forceFill(['created_at' => now()->subDays($daysAgo)])->save();

        return $row;
    }

    private function notification(User $user, int $daysAgo, bool $read): Notification
    {
        $row = Notification::create([
            'uid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'type' => 'file.shared',
            'module' => 'files',
            'title' => 'A file was shared with you',
            'read_at' => $read ? now()->subDays($daysAgo) : null,
        ]);
        $row->forceFill(['created_at' => now()->subDays($daysAgo)])->save();

        return $row;
    }

    public function test_it_deletes_activity_past_the_window_and_keeps_the_rest(): void
    {
        $user = $this->user(30);
        $old = $this->activity($user, 45);
        $recent = $this->activity($user, 5);

        $this->artisan('portal:prune-history')->assertSuccessful();

        $this->assertDatabaseMissing('activity_logs', ['id' => $old->id]);
        $this->assertDatabaseHas('activity_logs', ['id' => $recent->id]);
    }

    public function test_unread_notifications_survive_however_old(): void
    {
        $user = $this->user(7);
        $read = $this->notification($user, 30, true);
        $unread = $this->notification($user, 30, false);

        $this->artisan('portal:prune-history')->assertSuccessful();

        $this->assertDatabaseMissing('portal_notifications', ['id' => $read->id]);
        $this->assertDatabaseHas('portal_notifications', ['id' => $unread->id]);
    }

    public function test_each_account_gets_its_own_window(): void
    {
        $short = $this->user(7);
        $long = $this->user(365);
        $shortRow = $this->activity($short, 30);
        $longRow = $this->activity($long, 30);

        $this->artisan('portal:prune-history')->assertSuccessful();

        $this->assertDatabaseMissing('activity_logs', ['id' => $shortRow->id]);
        $this->assertDatabaseHas('activity_logs', ['id' => $longRow->id]);
    }

    public function test_a_user_who_never_chose_gets_the_thirty_day_default(): void
    {
        $user = $this->user();
        $old = $this->activity($user, 40);
        $recent = $this->activity($user, 20);

        $this->artisan('portal:prune-history')->assertSuccessful();

        $this->assertDatabaseMissing('activity_logs', ['id' => $old->id]);
        $this->assertDatabaseHas('activity_logs', ['id' => $recent->id]);
    }

    public function test_dry_run_deletes_nothing(): void
    {
        $user = $this->user(7);
        $old = $this->activity($user, 60);

        $this->artisan('portal:prune-history --dry-run')->assertSuccessful();

        $this->assertDatabaseHas('activity_logs', ['id' => $old->id]);
    }
}
