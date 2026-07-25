<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkDay;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WorkPlanTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_weekday_defaults_to_office_hours(): void
    {
        $user = $this->staff();

        // Pick a known Monday.
        $monday = '2026-07-20';

        $this->actingAs($user)
            ->getJson('/portal/calendar/work-plan/'.$monday)
            ->assertOk()
            ->assertJsonPath('day.status', 'in_office')
            ->assertJsonPath('day.startsAt', '08:00')
            ->assertJsonPath('day.endsAt', '17:00')
            ->assertJsonPath('day.isDefault', true);
    }

    public function test_weekend_defaults_to_not_working(): void
    {
        $user = $this->staff();

        $this->actingAs($user)
            ->getJson('/portal/calendar/work-plan/2026-07-25')
            ->assertOk()
            ->assertJsonPath('day.status', 'not_working')
            ->assertJsonPath('day.isDefault', true);
    }

    public function test_user_can_upsert_work_plan(): void
    {
        $user = $this->staff();

        $this->actingAs($user)
            ->putJson('/portal/calendar/work-plan', [
                'date' => '2026-07-21',
                'status' => 'remote',
                'startsAt' => '09:00',
                'endsAt' => '15:00',
                'location' => 'Home',
                'note' => 'Deep work',
                'visibility' => 'colleagues',
            ])
            ->assertOk()
            ->assertJsonPath('day.status', 'remote')
            ->assertJsonPath('day.location', 'Home');

        $this->assertDatabaseHas('work_days', [
            'user_id' => $user->id,
            'status' => 'remote',
            'location' => 'Home',
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
