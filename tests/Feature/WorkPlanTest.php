<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkDay;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * What survives of the work plan.
 *
 * The calendar's work-plan editor and its /portal/calendar/work-plan routes
 * were removed in 62063858, because WorkDay::resolveFor defaulted every
 * weekday to "In office" and stamped a chip on days the person was not
 * there. WorkDay itself stayed: the presence board, messaging and /me still
 * read it. These are the tests for that remainder; the three that drove the
 * deleted endpoints went with them.
 */
class WorkPlanTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_private_status_hidden_from_public_payload(): void
    {
        $user = $this->staff();

        WorkDay::create([
            'user_id' => $user->id,
            'work_date' => now()->toDateString(),
            'status' => 'on_leave',
            'visibility' => 'private',
        ]);

        $this->assertNull(WorkDay::publicStatusFor($user));
    }

    public function test_me_includes_work_status_when_visible(): void
    {
        $user = $this->staff();

        WorkDay::create([
            'user_id' => $user->id,
            'work_date' => now()->toDateString(),
            'status' => 'remote',
            'starts_at' => '08:00',
            'ends_at' => '17:00',
            'visibility' => 'colleagues',
        ]);

        $this->actingAs($user)
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('workStatus.status', 'remote')
            ->assertJsonPath('workStatus.label', 'Working remotely');
    }
}
