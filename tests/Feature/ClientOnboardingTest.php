<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
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

    /** Walk the wizard to the end, answering each step. */
    private function walk(User $user, array $overrides = []): void
    {
        $answers = array_merge([
            'welcome' => [],
            'name' => ['first_name' => 'Dana', 'last_name' => 'Reed'],
            'photo' => [],
            'email' => ['email_confirmed' => '1'],
            'phone' => ['phone' => '+1 555 123 4567'],
            'account-type' => ['account_type' => 'individual'],
            'address' => ['street' => '1 Bay Street', 'city' => 'Castries', 'country' => 'Saint Lucia'],
            'contact-preference' => ['preferred_contact' => 'Email'],
            'contacts' => [],
            'access' => [],
            'terms' => ['accept_terms' => '1'],
        ], $overrides);

        foreach ($answers as $step => $payload) {
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
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ])->assertRedirect('/');

        $invited = User::where('email', 'bruce@wayne.test')->firstOrFail();
        $this->assertSame(1, Client::count(), 'a second client record was created');

        // Straight into the wizard, not profile-setup.
        $this->actingAs($invited)->get('/')->assertRedirect(route('onboarding.index'));

        $this->walk($invited, ['name' => ['first_name' => 'Bruce', 'last_name' => 'Wayne']]);
        $this->actingAs($invited)->post('/onboarding-complete')->assertRedirect('/');

        $this->assertSame(1, User::where('email', 'bruce@wayne.test')->count());
        $this->assertSame($invited->id, $record->fresh()->user_id);
        $this->assertNotNull($invited->fresh()->onboarding_completed_at);
        // The firm's own note survived the client filling in their details.
        $this->assertSame('Referred by Lucius', $record->fresh()->data['notes']);
        $this->assertSame('Castries', $record->fresh()->data['addresses'][0]['city']);
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

    // ------------------------------------------------------------ every screen

    public function test_every_applicable_step_renders(): void
    {
        [$user] = $this->client();

        // Answer the two steps that unlock the conditional ones.
        $this->actingAs($user)->post('/onboarding/phone', [
            'phone' => '+1 555 123 4567', 'uses_whatsapp' => '1',
        ]);
        $this->actingAs($user)->post('/onboarding/account-type', ['account_type' => 'company']);

        foreach (ClientFlow::stepKeys() as $step) {
            if ($step === 'calendar' && ! ClientFlow::calendarAvailable()) {
                continue;
            }

            $this->actingAs($user)->get("/onboarding/{$step}")
                ->assertOk()
                ->assertSee('Step ', false);
        }
    }

    // ------------------------------------------------------- saving + resuming

    public function test_progress_is_saved_so_they_can_leave_and_come_back(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/welcome');
        $this->actingAs($user)->post('/onboarding/name', [
            'first_name' => 'Dana', 'middle_name' => 'M', 'last_name' => 'Reed',
        ])->assertRedirect(route('onboarding.show', ['step' => 'photo']));

        $progress = OnboardingProgress::where('user_id', $user->id)->first();
        $this->assertTrue($progress->hasDone('name'));
        $this->assertSame('Dana', $progress->answers('name')['first_name']);

        // Coming back lands on the next unfinished step, not the beginning.
        $this->actingAs($user)->get('/onboarding')
            ->assertRedirect(route('onboarding.show', ['step' => 'photo']));

        // And revisiting an answered step shows what they typed.
        $this->actingAs($user)->get('/onboarding/name')->assertOk()->assertSee('Dana');
    }

    public function test_a_required_step_refuses_an_empty_answer(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/name', ['first_name' => '', 'last_name' => ''])
            ->assertSessionHasErrors(['first_name', 'last_name']);

        $this->assertFalse(
            OnboardingProgress::where('user_id', $user->id)->first()?->hasDone('name') ?? false
        );
    }

    public function test_going_back_keeps_the_answers(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/welcome');
        $this->actingAs($user)->post('/onboarding/name', ['first_name' => 'Dana', 'last_name' => 'Reed']);

        $this->actingAs($user)->post('/onboarding/photo/back')
            ->assertRedirect(route('onboarding.show', ['step' => 'name']));

        $progress = OnboardingProgress::where('user_id', $user->id)->first();
        $this->assertSame('Reed', $progress->answers('name')['last_name']);
    }

    // ------------------------------------------------------ conditional steps

    public function test_company_details_are_only_asked_of_a_company(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/account-type', ['account_type' => 'individual']);
        $this->actingAs($user)->get('/onboarding/company')->assertRedirect();

        $this->actingAs($user)->post('/onboarding/account-type', ['account_type' => 'company']);
        $this->actingAs($user)->get('/onboarding/company')->assertOk()->assertSee('Company name');
    }

    public function test_whatsapp_is_only_asked_when_they_say_they_use_it(): void
    {
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/phone', ['phone' => '+1 555 123 4567']);
        $this->actingAs($user)->get('/onboarding/whatsapp')->assertRedirect();

        $this->actingAs($user)->post('/onboarding/phone', [
            'phone' => '+1 555 123 4567', 'uses_whatsapp' => '1',
        ]);
        $this->actingAs($user)->get('/onboarding/whatsapp')->assertOk();
    }

    // -------------------------------------------------------- what it writes

    public function test_finishing_writes_the_answers_to_the_user_and_the_client(): void
    {
        [$user, $client] = $this->client();

        $this->walk($user, [
            'name' => ['first_name' => 'Dana', 'middle_name' => 'M', 'last_name' => 'Reed-Smith'],
            'phone' => ['phone' => '+1 758 555 0101', 'uses_whatsapp' => '1'],
            'whatsapp' => ['whatsapp' => '+1 758 555 0202'],
            'contacts' => ['contacts' => [
                ['name' => 'Alex Fox', 'email' => 'alex@acme.test', 'role' => 'Finance contact'],
            ]],
        ]);
        $this->actingAs($user)->post('/onboarding-complete')->assertRedirect('/');

        $user->refresh();
        $this->assertSame('Dana M Reed-Smith', $user->name);
        $this->assertSame('Reed-Smith', $user->last_name);
        $this->assertSame('+1 758 555 0101', $user->phone);
        $this->assertNotNull($user->onboarding_completed_at);
        $this->assertNotNull($user->profile_completed_at);

        $profile = $client->fresh()->data;
        $this->assertSame('Dana', $profile['firstName']);
        $this->assertSame('Email', $profile['preferredContact']);
        $this->assertSame('Castries', $profile['addresses'][0]['city']);
        $this->assertSame('Alex Fox', $profile['additionalContacts'][0]['name']);

        // Both numbers are kept, typed.
        $types = array_column($profile['phones'], 'type');
        $this->assertContains('mobile', $types);
        $this->assertContains('whatsapp', $types);

        $this->assertSame('+1 758 555 0101', $client->fresh()->phone);
    }

    public function test_choosing_company_creates_or_reuses_one_company_record(): void
    {
        [$user, $client] = $this->client();
        $existing = Company::create(['uid' => 'acme-group', 'name' => 'Acme Group']);

        $this->walk($user, [
            'account-type' => ['account_type' => 'company'],
            'company' => ['company_name' => 'acme group', 'company_role' => 'Director'],
        ]);
        $this->actingAs($user)->post('/onboarding-complete');

        // Matched by name rather than creating a second Acme Group.
        $this->assertSame(1, Company::count());
        $this->assertSame($existing->id, $client->fresh()->company_id);
        $this->assertSame('Director', $user->fresh()->job_title);
    }

    public function test_a_new_company_is_created_when_there_is_no_match(): void
    {
        [$user, $client] = $this->client();

        $this->walk($user, [
            'account-type' => ['account_type' => 'company'],
            'company' => ['company_name' => 'Fresh Ventures Ltd', 'company_website' => 'fresh.test'],
        ]);
        $this->actingAs($user)->post('/onboarding-complete');

        $company = Company::first();
        $this->assertSame('Fresh Ventures Ltd', $company->name);
        $this->assertSame('fresh-ventures-ltd', $company->uid);
        $this->assertSame($company->id, $client->fresh()->company_id);
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
        $this->actingAs($user)->post('/onboarding-complete');

        // The portal is now reachable, and onboarding no longer intercepts.
        $this->actingAs($user->fresh())->get('/')->assertOk();
    }

    public function test_a_photo_is_stored_and_the_step_can_be_skipped(): void
    {
        Storage::fake('public');
        [$user] = $this->client();

        $this->actingAs($user)->post('/onboarding/photo', [
            'photo' => UploadedFile::fake()->image('me.jpg', 400, 400),
        ])->assertRedirect();

        $this->assertNotNull($user->fresh()->avatar_url);

        // And skipping is allowed — it is an optional step.
        [$other] = $this->client(['email' => 'other@example.test']);
        $this->actingAs($other)->post('/onboarding/photo')->assertRedirect();
        $this->assertTrue(
            OnboardingProgress::where('user_id', $other->id)->first()->hasDone('photo')
        );
    }
}
