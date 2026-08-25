<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\OnboardingProgress;
use App\Models\User;
use App\Support\Onboarding\ClientFlow;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Phase 5 — the guided onboarding a client walks through after accepting an
 * invitation: every step renders, progress survives leaving, conditional steps
 * appear only when they apply, and the answers land on the real records.
 */
class ClientOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private int $made = 0;

    private function client(array $userOverrides = []): array
    {
        $suffix = $this->made++ ? '-'.$this->made : '';

        $user = User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => null,
            'onboarding_completed_at' => null,
            'first_name' => 'Dana',
            'last_name' => 'Reed',
        ], $userOverrides));

        $client = Client::create([
            'uid' => 'dana-reed'.$suffix,
            'name' => 'Dana Reed',
            'email' => $user->email,
            'user_id' => $user->id,
            'initial' => 'D',
            'initial_color' => 'blue',
            'data' => [],
        ]);

        return [$user, $client];
    }

    /** Walk through personal setup after the client wizard or getting-started. */
    private function completeAccountSetup(User $user): void
    {
        $this->actingAs($user)->post('/auth/setup/preferences', [
            'themeMode' => 'light',
            'fontScale' => 3,
            'sidebarStyle' => 'hover',
        ])->assertRedirect('/auth/setup/two-factor');

        $this->actingAs($user)->post('/auth/setup/two-factor/skip')
            ->assertRedirect('/auth/setup/notifications');

        $this->actingAs($user)->post('/auth/setup/notifications', [
            'messages' => ['portal' => '1', 'desktop' => '1'],
            'email' => ['portal' => '1', 'desktop' => '0'],
            'calendar' => ['portal' => '1', 'desktop' => '0'],
            'files' => ['portal' => '1', 'desktop' => '0'],
            'approvals' => ['portal' => '1', 'desktop' => '0'],
        ])->assertRedirect('/');
    }

    /** Walk the wizard to the end, answering each step. */
    private function walk(User $user, array $overrides = []): void
    {
        $answers = array_merge([
            'welcome' => [],
            'you' => ['first_name' => 'Dana', 'last_name' => 'Reed'],
            'contact' => [
                'email_confirmed' => '1',
                'phone' => '+1 555 123 4567',
                'preferred_contact' => 'Email',
            ],
            'calendar' => [],
            'terms' => ['accept_terms' => '1'],
        ], $overrides);

        foreach ($answers as $step => $payload) {
            if ($step === 'calendar' && ! ClientFlow::calendarAvailable()) {
                continue;
            }
            $this->actingAs($user)->post("/onboarding/{$step}", $payload);
        }
    }

    /**
     * Test Phase C end to end: a staff member invites a client, the client
     * accepts the emailed link, and is walked straight into onboarding — no
     * second account, no profile-setup detour, and the client record they were
     * invited against is the one that ends up filled in.
     */
    public function test_the_whole_journey_from_invitation_to_finished_onboarding(): void
    {
        Mail::fake();

        $staff = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $record = Client::create([
            'uid' => 'wayne-enterprises', 'name' => 'Bruce Wayne',
            'email' => 'bruce@wayne.test', 'initial' => 'B',
            'initial_color' => 'blue', 'data' => ['notes' => 'Referred by Lucius'],
        ]);

        $this->actingAs($staff)->postJson("/portal/clients/{$record->uid}/invite")->assertOk();

        $token = null;
        Mail::assertSent(Postcard::class, function ($mail) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $token = $m[1];
            }

            return true;
        });

        $this->app['auth']->forgetGuards();
        $this->post("/invite/{$token}", [
            'first_name' => 'Bruce', 'last_name' => 'Wayne', 'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ])->assertRedirect('/');

        $invited = User::where('email', 'bruce@wayne.test')->firstOrFail();
        $this->assertSame(1, Client::count(), 'a second client record was created');

        // Straight into the wizard, not profile-setup.
        $this->actingAs($invited)->get('/')->assertRedirect(route('onboarding.index'));

        $this->walk($invited, ['you' => ['first_name' => 'Bruce', 'last_name' => 'Wayne']]);
        $this->actingAs($invited)->post('/onboarding-complete')
            ->assertRedirect(route('account-setup.show', ['step' => 'preferences']));
        $this->completeAccountSetup($invited);

        $this->assertSame(1, User::where('email', 'bruce@wayne.test')->count());
        $this->assertSame($invited->id, $record->fresh()->user_id);
        $this->assertNotNull($invited->fresh()->onboarding_completed_at);
        // The firm's own note survived the client filling in their details.
        $this->assertSame('Referred by Lucius', $record->fresh()->data['notes']);
    }

    // ------------------------------------------------------------- entry point

    public function test_a_client_is_sent_to_guided_onboarding_not_profile_setup(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->get('/')->assertRedirect(route('onboarding.index'));

        $this->actingAs($user)->get('/onboarding')
            ->assertRedirect(route('onboarding.show', ['step' => 'welcome']));
    }

    public function test_staff_still_get_the_security_checklist(): void
    {
        $staff = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => null,
        ]);

        $this->actingAs($staff)->get('/')->assertRedirect(route('getting-started'));
    }

    public function test_a_client_still_gets_the_wizard_if_getting_started_was_marked_done(): void
    {
        [$user] = $this->client([
            'profile_completed_at' => now(),
            'preferences' => [
                'accountsSetupComplete' => true,
                'accountSetupStep' => 'preferences',
            ],
        ]);

        $this->actingAs($user)->get('/')->assertRedirect(route('onboarding.index'));
        $this->actingAs($user)->get(route('getting-started'))->assertRedirect(route('onboarding.index'));
        $this->actingAs($user)->get(route('account-setup.show', ['step' => 'preferences']))
            ->assertRedirect(route('onboarding.index'));
        $this->actingAs($user)->get(route('onboarding.show', ['step' => 'welcome']))
            ->assertOk()
            ->assertSee('Welcome')
            ->assertSee('Get started');
    }

    // ------------------------------------------------------------ every screen

    public function test_every_applicable_step_renders(): void
    {
        [$user] = $this->client();
        $progress = OnboardingProgress::firstOrCreate(
            ['user_id' => $user->id],
            [
                'flow' => OnboardingProgress::FLOW_CLIENT,
                'current_step' => 'welcome',
                'completed_steps' => [],
                'answers' => [],
                'started_at' => now(),
            ],
        );

        foreach (ClientFlow::applicableSteps($progress) as $step) {
            $this->actingAs($user)->get("/onboarding/{$step}")
                ->assertOk()
                ->assertSee(' complete', false)
                ->assertDontSee('Step ', false);
        }

        $this->actingAs($user)->get('/onboarding/you')->assertSee('tma-auth__stack', false);
    }

    public function test_the_terms_step_lists_cip_when_the_module_is_on(): void
    {
        [$user] = $this->client();

        config(['services.cip.enabled' => true]);
        $this->actingAs($user)->get('/onboarding/terms')
            ->assertOk()
            ->assertSee('Included with this account')
            ->assertSee('CIP Applications')
            ->assertSee('Manage your CIP applications.')
            ->assertSee('Terms of Service');

        config(['services.cip.enabled' => false]);
        $this->actingAs($user)->get('/onboarding/terms')
            ->assertOk()
            ->assertDontSee('CIP Applications');
    }

    public function test_related_questions_share_a_screen(): void
    {
        $this->assertSame(
            ['welcome', 'you', 'contact', 'calendar', 'terms'],
            ClientFlow::stepKeys(),
        );
    }

    public function test_calendar_connect_is_its_own_step_when_a_provider_is_configured(): void
    {
        [$user] = $this->client();
        config([
            'services.google.client_id' => 'test-client-id.apps.googleusercontent.com',
            'services.microsoft.client_id' => null,
        ]);

        $this->actingAs($user)->get('/onboarding/calendar')
            ->assertOk()
            ->assertSee('Connect a calendar')
            ->assertSee('Connect Google')
            ->assertDontSee('Included with this account');

        $this->actingAs($user)->get('/onboarding/terms')
            ->assertOk()
            ->assertSee('Included with this account')
            ->assertSee('I agree to the');
    }

    public function test_calendar_is_skipped_when_no_provider_is_configured(): void
    {
        [$user] = $this->client();
        config([
            'services.google.client_id' => null,
            'services.microsoft.client_id' => null,
        ]);

        $this->actingAs($user)->get('/onboarding/calendar')
            ->assertRedirect(route('onboarding.show', ['step' => 'welcome']));

        $this->actingAs($user)->post('/onboarding/contact', [
            'email_confirmed' => '1',
            'phone' => '+1 555 123 4567',
            'preferred_contact' => 'Email',
        ])->assertRedirect(route('onboarding.show', ['step' => 'terms']));
    }

    public function test_old_step_urls_open_the_joined_screen(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->get('/onboarding/name')
            ->assertRedirect(route('onboarding.show', ['step' => 'you']));
        $this->actingAs($user)->get('/onboarding/phone')
            ->assertRedirect(route('onboarding.show', ['step' => 'contact']));
        $this->actingAs($user)->get('/onboarding/account-type')
            ->assertRedirect(route('onboarding.show', ['step' => 'terms']));
        $this->actingAs($user)->get('/onboarding/work')
            ->assertRedirect(route('onboarding.show', ['step' => 'terms']));
        $this->actingAs($user)->get('/onboarding/access')
            ->assertRedirect(route('onboarding.show', ['step' => 'terms']));
    }

    public function test_old_one_question_progress_skips_joined_screens_already_answered(): void
    {
        [$user] = $this->client();

        OnboardingProgress::create([
            'user_id' => $user->id,
            'flow' => OnboardingProgress::FLOW_CLIENT,
            'current_step' => 'photo',
            'completed_steps' => ['welcome', 'name'],
            'answers' => ['name' => ['first_name' => 'Dana', 'last_name' => 'Reed']],
            'started_at' => now(),
        ]);

        $this->actingAs($user)->get('/onboarding')
            ->assertRedirect(route('onboarding.show', ['step' => 'contact']));
    }

    // ------------------------------------------------------- saving + resuming

    public function test_progress_is_saved_so_they_can_leave_and_come_back(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/welcome');
        $this->actingAs($user)->post('/onboarding/you', [
            'first_name' => 'Dana', 'middle_name' => 'M', 'last_name' => 'Reed',
        ])->assertRedirect(route('onboarding.show', ['step' => 'contact']));

        $progress = OnboardingProgress::where('user_id', $user->id)->first();
        $this->assertTrue($progress->hasDone('you'));
        $this->assertSame('Dana', $progress->answers('you')['first_name']);

        // Coming back lands on the next unfinished step, not the beginning.
        $this->actingAs($user)->get('/onboarding')
            ->assertRedirect(route('onboarding.show', ['step' => 'contact']));

        // And revisiting an answered step shows what they typed.
        $this->actingAs($user)->get('/onboarding/you')->assertOk()->assertSee('Dana');
    }

    public function test_a_required_step_refuses_an_empty_answer(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/you', ['first_name' => '', 'last_name' => ''])
            ->assertSessionHasErrors(['first_name', 'last_name']);

        $this->assertFalse(
            OnboardingProgress::where('user_id', $user->id)->first()?->hasDone('you') ?? false
        );
    }

    public function test_going_back_keeps_the_answers(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/welcome');
        $this->actingAs($user)->post('/onboarding/you', ['first_name' => 'Dana', 'last_name' => 'Reed']);

        $this->actingAs($user)->post('/onboarding/contact/back')
            ->assertRedirect(route('onboarding.show', ['step' => 'you']));

        $progress = OnboardingProgress::where('user_id', $user->id)->first();
        $this->assertSame('Reed', $progress->answers('you')['last_name']);
    }

    // ------------------------------------------------------ contact extras

    public function test_whatsapp_is_collected_on_the_contact_screen(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->get('/onboarding/contact')
            ->assertOk()
            ->assertSee('I use WhatsApp')
            ->assertSee('WhatsApp number');

        $this->actingAs($user)->post('/onboarding/contact', [
            'email_confirmed' => '1',
            'phone' => '+1 555 123 4567',
            'uses_whatsapp' => '1',
            'whatsapp' => '+1 555 999 0000',
            'preferred_contact' => 'WhatsApp',
        ])->assertRedirect(route('onboarding.show', [
            'step' => ClientFlow::calendarAvailable() ? 'calendar' : 'terms',
        ]));

        $this->assertSame('+1 555 999 0000', OnboardingProgress::where('user_id', $user->id)->first()->answers('contact')['whatsapp']);
    }

    // -------------------------------------------------------- what it writes

    public function test_finishing_writes_the_answers_to_the_user_and_the_client(): void
    {
        [$user, $client] = $this->client();

        $this->walk($user, [
            'you' => ['first_name' => 'Dana', 'middle_name' => 'M', 'last_name' => 'Reed-Smith'],
            'contact' => [
                'email_confirmed' => '1',
                'phone' => '+1 758 555 0101',
                'uses_whatsapp' => '1',
                'whatsapp' => '+1 758 555 0202',
                'preferred_contact' => 'Email',
            ],
        ]);
        $this->actingAs($user)->post('/onboarding-complete')
            ->assertRedirect(route('account-setup.show', ['step' => 'preferences']));
        $this->completeAccountSetup($user);

        $user->refresh();
        $this->assertSame('Dana M Reed-Smith', $user->name);
        $this->assertSame('Reed-Smith', $user->last_name);
        $this->assertSame('+1 758 555 0101', $user->phone);
        $this->assertNotNull($user->onboarding_completed_at);
        $this->assertNotNull($user->profile_completed_at);

        $profile = $client->fresh()->data;
        $this->assertSame('Dana', $profile['firstName']);
        $this->assertSame('Email', $profile['preferredContact']);

        // Both numbers are kept, typed.
        $types = array_column($profile['phones'], 'type');
        $this->assertContains('mobile', $types);
        $this->assertContains('whatsapp', $types);

        $this->assertSame('+1 758 555 0101', $client->fresh()->phone);
    }

    public function test_the_firms_own_notes_are_not_overwritten(): void
    {
        [$user, $client] = $this->client();
        $client->forceFill(['data' => [
            'notes' => 'Referred by Bruce Wayne',
            'work' => ['department' => 'Legal'],
        ]])->save();

        $this->walk($user);
        $this->actingAs($user)->post('/onboarding-complete');

        $profile = $client->fresh()->data;
        $this->assertSame('Referred by Bruce Wayne', $profile['notes']);
        $this->assertSame('Legal', $profile['work']['department']);
    }

    // ---------------------------------------------------------- finishing up

    public function test_assigned_staff_are_notified_on_completion(): void
    {
        [$user, $client] = $this->client();
        $staff = User::factory()->create(['status' => 'approved', 'account_type' => 'Reviewing Officer']);
        ClientAssignment::create([
            'client_id' => $client->id, 'user_id' => $staff->id,
            'permission_level' => 'editor', 'is_primary' => true,
        ]);

        $this->walk($user);
        $this->actingAs($user)->post('/onboarding-complete');

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $staff->id,
            'type' => 'client.account_activity',
        ]);
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'client.account_activity']);
    }

    public function test_onboarding_cannot_be_finished_with_a_required_step_unanswered(): void
    {
        [$user] = $this->client();

        // Terms never accepted.
        $this->walk($user, ['terms' => []]);

        $this->actingAs($user)->post('/onboarding-complete')
            ->assertRedirect(route('onboarding.show', ['step' => 'terms']));

        $this->assertNull($user->fresh()->onboarding_completed_at);
    }

    public function test_a_finished_client_is_not_sent_back_through_the_wizard(): void
    {
        [$user] = $this->client();
        $this->walk($user);
        $this->actingAs($user)->post('/onboarding-complete')
            ->assertRedirect(route('account-setup.show', ['step' => 'preferences']));
        $this->completeAccountSetup($user);

        // The portal is now reachable, and onboarding no longer intercepts.
        $this->actingAs($user->fresh())->get('/')->assertOk();
    }

    public function test_a_photo_is_stored_and_the_step_can_be_skipped(): void
    {
        Storage::fake('public');
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/you', [
            'photo' => UploadedFile::fake()->image('me.jpg', 400, 400),
            'first_name' => 'Dana',
            'last_name' => 'Reed',
        ])->assertRedirect();

        $this->assertNotNull($user->fresh()->avatar_url);

        [$other] = $this->client(['email' => 'other@example.test']);
        $this->actingAs($other)->post('/onboarding/you', [
            'first_name' => 'Other',
            'last_name' => 'Person',
        ])->assertRedirect();
        $this->assertTrue(
            OnboardingProgress::where('user_id', $other->id)->first()->hasDone('you')
        );
    }
}
