<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Bespoke AI ships dark behind FEATURE_BESPOKE. While the flag is off the
 * routes 404 for everyone, administrators included — never 403.
 */
class BespokeAccessTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_everything_404s_when_the_flag_is_off(): void
    {
        config(['services.bespoke.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->getJson('/portal/bespoke/suggestions')->assertNotFound();
        $this->actingAs($admin)->postJson('/portal/bespoke/chat', [
            'messages' => [['role' => 'user', 'content' => 'Where is File Library?']],
        ])->assertNotFound();
    }

    public function test_logged_out_json_is_unauthorized_not_a_404_from_the_flag(): void
    {
        config(['services.bespoke.enabled' => true]);

        $this->getJson('/portal/bespoke/suggestions')->assertUnauthorized();
        $this->postJson('/portal/bespoke/chat', [
            'messages' => [['role' => 'user', 'content' => 'Hello']],
        ])->assertUnauthorized();
    }

    public function test_logged_out_html_redirects_to_sign_in(): void
    {
        config(['services.bespoke.enabled' => true]);

        $this->get('/portal/bespoke/suggestions')->assertRedirect(route('login'));
    }

    public function test_the_shell_tells_the_page_when_bespoke_is_on(): void
    {
        config(['services.bespoke.enabled' => true, 'services.cip.enabled' => true]);
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($officer)
            ->get('/')
            ->assertOk()
            ->assertSee('window.TMABootBespoke=true', escape: false);
    }

    public function test_the_shell_tells_the_page_when_bespoke_is_off(): void
    {
        config(['services.bespoke.enabled' => false]);
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($officer)
            ->get('/')
            ->assertOk()
            ->assertSee('window.TMABootBespoke=false', escape: false);
    }

    public function test_suggestions_are_role_and_path_aware(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.cip.enabled' => true,
        ]);

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $client = $this->user(Role::CLIENT);

        $dash = $this->actingAs($officer)
            ->getJson('/portal/bespoke/suggestions?path=/')
            ->assertOk()
            ->json();

        $this->assertFalse($dash['configured']);
        $this->assertTrue($dash['cipEnabled']);
        $labels = collect($dash['chips'])->pluck('label')->all();
        $this->assertContains('What’s on this dashboard?', $labels);
        $this->assertContains('How do I start a CIP application?', $labels);

        $cip = $this->actingAs($officer)
            ->getJson('/portal/bespoke/suggestions?path=/citizenship-applications')
            ->assertOk()
            ->json();
        $cipLabels = collect($cip['chips'])->pluck('label')->all();
        $this->assertContains('What are the queues?', $cipLabels);

        $clientDash = $this->actingAs($client)
            ->getJson('/portal/bespoke/suggestions?path=/')
            ->assertOk()
            ->json();
        $clientLabels = collect($clientDash['chips'])->pluck('label')->implode(' ');
        $this->assertStringNotContainsString('Users', $clientLabels);
        $this->assertStringNotContainsString('Reporting', $clientLabels);
        $this->assertNotContains('/users', $clientDash['allowedPaths']);
        $this->assertNotContains('/reporting', $clientDash['allowedPaths']);
    }

    public function test_cip_chips_vanish_when_cip_is_off(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.cip.enabled' => false,
        ]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $payload = $this->actingAs($admin)
            ->getJson('/portal/bespoke/suggestions?path=/')
            ->assertOk()
            ->json();

        $this->assertFalse($payload['cipEnabled']);
        $labels = collect($payload['chips'])->pluck('label')->implode(' ');
        $this->assertStringNotContainsString('CIP', $labels);
    }

    public function test_local_faq_answers_without_a_key(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => '',
            'services.cip.enabled' => true,
        ]);
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'What’s the difference between Save as draft and Add?']],
                'clientContext' => ['path' => '/citizenship-applications/new', 'view' => 'clients'],
            ])
            ->assertOk()
            ->json();

        $this->assertFalse($payload['configured']);
        $this->assertSame('local', $payload['source']);
        $this->assertStringContainsString('Save as draft', $payload['reply']);
        $this->assertStringContainsString('New Applications', $payload['reply']);

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $officer->id,
            'activity_type' => 'bespoke.asked',
            'module' => 'bespoke',
        ]);
        $log = ActivityLog::query()->where('activity_type', 'bespoke.asked')->first();
        $this->assertSame('/citizenship-applications/new', $log->metadata['path']);
        $this->assertArrayNotHasKey('content', $log->metadata ?? []);
    }

    public function test_client_cannot_be_told_about_users_from_a_spoofed_context(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.cip.enabled' => true,
        ]);
        $client = $this->user(Role::CLIENT);

        $payload = $this->actingAs($client)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'Why don’t I see Users, Reporting, or CIP Console?']],
                'clientContext' => [
                    'path' => '/users',
                    'view' => 'users',
                    'title' => 'Users',
                    'accountType' => 'Administrator',
                ],
            ])
            ->assertOk()
            ->json();

        $this->assertStringContainsString('administration', mb_strtolower($payload['reply']));
        $this->assertStringNotContainsString('/users', $payload['reply']);
    }

    public function test_the_model_path_runs_when_a_key_is_configured(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => 'sk-test',
            'services.cip.enabled' => true,
        ]);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [[
                    'message' => ['role' => 'assistant', 'content' => 'Open [File Library](/folders/all).'],
                ]],
            ], 200),
        ]);

        $officer = $this->user(Role::REVIEWING_OFFICER);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'Where is File Library?']],
                'clientContext' => ['path' => '/'],
            ])
            ->assertOk()
            ->json();

        $this->assertTrue($payload['configured']);
        $this->assertSame('model', $payload['source']);
        $this->assertStringContainsString('/folders/all', $payload['reply']);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/chat/completions'));
    }

    public function test_me_reports_whether_bespoke_exists(): void
    {
        config(['services.bespoke.enabled' => true, 'services.bespoke.key' => '']);
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($officer)
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('bespoke.enabled', true)
            ->assertJsonPath('bespoke.configured', false);
    }
}
