<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * Bespoke AI is on by default. FEATURE_BESPOKE=false is the kill switch:
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
        $this->actingAs($admin)->getJson('/portal/bespoke/conversations')->assertNotFound();
        $this->actingAs($admin)->get('/bespoke-ai')->assertNotFound();
    }

    public function test_logged_out_json_is_unauthorized_not_a_404_from_the_flag(): void
    {
        config(['services.bespoke.enabled' => true]);

        $this->getJson('/portal/bespoke/suggestions')->assertUnauthorized();
        $this->getJson('/portal/bespoke/conversations')->assertUnauthorized();
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
            ->assertSee('window.TMABootBespoke=true', escape: false)
            ->assertSee('data-nav="bespoke"', escape: false)
            ->assertSee('Bespoke AI Assistant')
            ->assertSee('>Bespoke AI</span>', escape: false)
            ->assertSee('images/brand/tma/bespoke-ai-mark.png', escape: false);
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

    public function test_the_model_path_retries_in_the_newer_dialect_when_max_tokens_is_rejected(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => "sk-test\n",
            'services.bespoke.model' => 'gpt-5-mini',
        ]);
        Http::fake([
            'api.openai.com/*' => Http::sequence()
                ->push([
                    'error' => [
                        'message' => "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
                        'type' => 'invalid_request_error',
                        'code' => 'unsupported_parameter',
                    ],
                ], 400)
                ->push([
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

        $this->assertSame('model', $payload['source']);
        $this->assertStringContainsString('/folders/all', $payload['reply']);
        Http::assertSentCount(2);
        Http::assertSent(fn ($request) => array_key_exists('max_tokens', $request->data())
            && $request->hasHeader('Authorization', 'Bearer sk-test'));
        Http::assertSent(fn ($request) => array_key_exists('max_completion_tokens', $request->data())
            && ! array_key_exists('max_tokens', $request->data())
            && ! array_key_exists('temperature', $request->data()));
    }

    public function test_a_rejected_key_logs_the_provider_message_and_falls_back(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => 'sk-bad',
            'services.bespoke.model' => 'gpt-4o-mini, gpt-4.1-mini',
        ]);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'error' => [
                    'message' => 'Incorrect API key provided: sk-bad.',
                    'type' => 'invalid_request_error',
                    'code' => 'invalid_api_key',
                ],
            ], 401),
        ]);
        Log::spy();

        $officer = $this->user(Role::REVIEWING_OFFICER);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'Can you write an email?']],
                'clientContext' => ['path' => '/'],
            ])
            ->assertOk()
            ->json();

        $this->assertTrue($payload['configured']);
        $this->assertSame('local', $payload['source']);
        $this->assertStringContainsString('could not reach the language model', $payload['reply']);
        Http::assertSentCount(1);
        Log::shouldHaveReceived('warning')->once()->with(
            'Bespoke AI HTTP error',
            \Mockery::on(fn (array $context) => $context['status'] === 401
                && $context['code'] === 'invalid_api_key'
                && $context['host'] === 'api.openai.com'
                && str_contains($context['message'], 'Incorrect API key')),
        );
    }

    public function test_a_retired_model_hands_over_to_the_next_listed_model(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => 'gsk_test',
            'services.bespoke.base_url' => 'https://api.groq.com/openai/v1',
            'services.bespoke.model' => 'llama-3.3-70b-versatile, openai/gpt-oss-120b, openai/gpt-oss-20b',
        ]);
        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push([
                    'error' => [
                        'message' => 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.',
                        'type' => 'invalid_request_error',
                        'code' => 'model_not_found',
                    ],
                ], 404)
                ->push([
                    'choices' => [[
                        'message' => ['role' => 'assistant', 'content' => 'Open [File Library](/folders/all).'],
                        'finish_reason' => 'stop',
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

        $this->assertSame('model', $payload['source']);
        $this->assertStringContainsString('/folders/all', $payload['reply']);
        Http::assertSentCount(2);
        Http::assertSent(fn ($request) => $request->data()['model'] === 'llama-3.3-70b-versatile');
        Http::assertSent(fn ($request) => $request->data()['model'] === 'openai/gpt-oss-120b'
            && str_starts_with($request->url(), 'https://api.groq.com/openai/v1/chat/completions'));
        Http::assertNotSent(fn ($request) => $request->data()['model'] === 'openai/gpt-oss-20b');
    }

    public function test_the_assistant_page_is_open_to_every_approved_account_when_the_flag_is_on(): void
    {
        config(['services.bespoke.enabled' => true]);

        $this->actingAs($this->user(Role::CLIENT))->get('/bespoke-ai')->assertOk();
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))->get('/bespoke-ai')->assertOk();
        $this->actingAs($this->user(Role::ADMINISTRATOR))->get('/bespoke-ai')->assertOk();
    }

    public function test_chat_persists_and_another_account_cannot_read_it(): void
    {
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => '',
            'services.cip.enabled' => true,
        ]);

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $other = $this->user(Role::CLIENT);
        $conversationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'What’s the difference between Save as draft and Add?']],
                'conversationId' => $conversationId,
                'clientContext' => ['path' => '/citizenship-applications/new', 'view' => 'clients'],
            ])
            ->assertOk()
            ->assertJsonPath('conversationId', $conversationId);

        $this->assertDatabaseHas('bespoke_conversations', [
            'uuid' => $conversationId,
            'user_id' => $officer->id,
        ]);
        $this->assertDatabaseHas('bespoke_messages', [
            'role' => 'user',
        ]);

        $list = $this->actingAs($officer)
            ->getJson('/portal/bespoke/conversations')
            ->assertOk()
            ->json('conversations');
        $this->assertCount(1, $list);
        $this->assertSame($conversationId, $list[0]['uuid']);
        $this->assertStringNotContainsString('**', $list[0]['preview']);

        $this->actingAs($other)
            ->getJson('/portal/bespoke/conversations')
            ->assertOk()
            ->assertJsonPath('conversations', []);

        $this->actingAs($other)
            ->getJson('/portal/bespoke/conversations/'.$conversationId)
            ->assertNotFound();

        $this->actingAs($other)
            ->patchJson('/portal/bespoke/conversations/'.$conversationId, ['title' => 'Stolen'])
            ->assertNotFound();

        $this->actingAs($other)
            ->deleteJson('/portal/bespoke/conversations/'.$conversationId)
            ->assertNotFound();

        $detail = $this->actingAs($officer)
            ->getJson('/portal/bespoke/conversations/'.$conversationId)
            ->assertOk()
            ->json('conversation');
        $this->assertSame($conversationId, $detail['uuid']);
        $this->assertNotEmpty($detail['messages']);
        $this->assertSame('user', $detail['messages'][0]['role']);

        $this->actingAs($officer)
            ->patchJson('/portal/bespoke/conversations/'.$conversationId, ['title' => 'Draft vs Add'])
            ->assertOk()
            ->assertJsonPath('conversation.title', 'Draft vs Add');

        $this->actingAs($officer)
            ->get('/bespoke-ai/'.$conversationId)
            ->assertOk();

        $this->actingAs($officer)
            ->deleteJson('/portal/bespoke/conversations/'.$conversationId)
            ->assertOk();

        $this->assertDatabaseMissing('bespoke_conversations', ['uuid' => $conversationId]);
    }
}
