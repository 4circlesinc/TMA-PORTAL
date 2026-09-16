<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * Every web response says where its time went.
 *
 * The header is how a slow screen gets diagnosed from the browser's Network
 * panel rather than from a query log in tinker, so it has to be on the JSON
 * the portal's screens actually fetch, and it has to carry a real query
 * count - a request that touched the database cannot report zero.
 */
class ServerTimingTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_json_response_reports_db_and_app_time(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->getJson('/me')->assertOk();

        $header = (string) $response->headers->get('Server-Timing');

        $this->assertMatchesRegularExpression('/\bdb;dur=\d+(\.\d+)?;desc="(\d+) queries"/', $header);
        $this->assertMatchesRegularExpression('/\bapp;dur=\d+(\.\d+)?/', $header);
        $this->assertMatchesRegularExpression('/\btotal;dur=\d+(\.\d+)?/', $header);

        preg_match('/desc="(\d+) queries"/', $header, $m);
        $this->assertGreaterThan(0, (int) $m[1], '/me reads the user, so the count cannot be zero: '.$header);
    }

    public function test_a_request_over_the_threshold_is_logged_with_its_slowest_statement(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        // Every request is "slow" at a zero threshold; a real one only
        // trips the default after seconds.
        config(['app.slow_request_ms' => 1]);
        Log::spy();

        $this->actingAs($user)->getJson('/me')->assertOk();

        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context) use ($user) {
            return $message === 'Slow request'
                && $context['path'] === 'me'
                && $context['user'] === $user->id
                && $context['queries'] > 0
                && is_string($context['slowest_sql'])
                && str_contains(strtolower($context['slowest_sql']), 'select')
                // The shape, with its placeholders; never the bindings.
                && ! str_contains($context['slowest_sql'], $user->email);
        })->once();
    }

    public function test_a_quick_request_is_not_logged(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        Log::spy();

        $this->actingAs($user)->getJson('/me')->assertOk();

        Log::shouldNotHaveReceived('warning');
    }

    public function test_the_header_carries_no_sql(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $header = (string) $this->actingAs($user)->getJson('/me')->headers->get('Server-Timing');

        $this->assertStringNotContainsStringIgnoringCase('select', $header);
        $this->assertStringNotContainsString($user->email, $header);
    }
}
