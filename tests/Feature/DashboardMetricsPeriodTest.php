<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The KPI row's default window.
 *
 * The head picker and the metrics request have to name the same period. The
 * shell ships the label in its own markup and portal-home falls back to a
 * matching key when nothing is stored; if those two drift the head says one
 * window while the cards count another.
 *
 * The default is a month because a day is usually empty, and an empty day is
 * indistinguishable from a broken card — which is exactly how it was read.
 */
class DashboardMetricsPeriodTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::create([
            'name' => 'Ada Admin', 'email' => 'ada@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
        ])->save();

        return $user;
    }

    public function test_the_shell_ships_the_month_as_the_resting_period(): void
    {
        $this->actingAs($this->admin())
            ->get('/')
            ->assertOk()
            ->assertSee('<span data-today-label>This month</span>', escape: false);
    }

    public function test_the_metrics_endpoint_still_answers_every_period(): void
    {
        $user = $this->admin();

        // The picker offers four windows; the default moving must not narrow
        // what the server accepts.
        foreach (['today', 'week', 'month', 'year'] as $period) {
            $this->actingAs($user)
                ->getJson('/portal/dashboard/metrics?period='.$period)
                ->assertOk()
                ->assertJsonStructure(['cards']);
        }
    }
}
