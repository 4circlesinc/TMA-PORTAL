<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Sending and chasing an invitation from the Clients hub — the path staff take
 * when a client says they never received the email.
 */
class ClientHubInviteTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $type = 'Employee'): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function client(array $o = []): Client
    {
        return Client::create(array_merge([
            'uid' => 'acme-co', 'name' => 'Acme Co', 'email' => 'owner@acme.test',
            'initial' => 'A', 'initial_color' => 'blue', 'data' => [],
        ], $o));
    }

    public function test_the_hub_reports_no_invitation_before_one_is_sent(): void
    {
        $staff = $this->staff();
        $client = $this->client();

        $this->actingAs($staff)->getJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('hasAccount', false)
            ->assertJsonPath('invitation', null);
    }

    public function test_an_employee_can_send_and_then_chase_an_invitation(): void
    {
        Mail::fake();
        $staff = $this->staff('Employee');
        $client = $this->client();

        // First press: a first ask.
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('reminder', false);

        // Second press: the same invitation, chased.
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('reminder', true);

        $this->assertSame(1, Invitation::count(), 'chasing created a second invitation');
        $this->assertSame(2, Invitation::first()->send_count);
    }

    public function test_the_hub_reflects_the_invitation_state_for_the_toolbar(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        // This is what decides whether the button says Invite or Resend.
        $this->actingAs($staff)->getJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('hasAccount', false)
            ->assertJsonPath('invitation.canResend', true)
            ->assertJsonPath('invitation.canCancel', true);
    }

    public function test_chasing_sends_a_fresh_link_and_kills_the_old_one(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();

        $tokens = [];
        $capture = function () use (&$tokens) {
            $tokens = [];
            Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$tokens) {
                if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                    $tokens[] = $m[1];
                }

                return true;
            });
        };

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $capture();
        $first = $tokens[0];

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $capture();
        $second = end($tokens);

        $this->assertNotSame($first, $second);

        // The client following the newest email gets in; the stale link does not.
        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$first}")->assertOk()->assertSee('may have been replaced by a newer invitation');
        $this->get("/invite/{$second}")->assertOk()->assertSee('Create your account');
    }

    public function test_a_client_with_no_email_cannot_be_invited(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client(['email' => null]);

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")
            ->assertStatus(422);
    }

    public function test_a_client_who_already_signed_up_cannot_be_invited_again(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $account = User::factory()->create(['status' => 'approved']);
        $client = $this->client(['user_id' => $account->id]);

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")
            ->assertStatus(422);

        $this->actingAs($staff)->getJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('hasAccount', true);
    }

    public function test_a_client_account_cannot_invite_anyone(): void
    {
        Mail::fake();
        $client = $this->client();

        $this->actingAs($this->staff('Client'))
            ->postJson("/portal/clients/{$client->uid}/invite")
            ->assertForbidden();
    }

    public function test_a_failed_send_still_leaves_a_chasable_invitation(): void
    {
        $staff = $this->staff();
        $client = $this->client();

        Mail::shouldReceive('to->sendNow')->andThrow(new \RuntimeException('mailbox unavailable'));

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        // The hub shows the failure and still offers to try again — this is the
        // state a client "not getting the invitation" actually looks like.
        $this->actingAs($staff)->getJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('invitation.status', 'failed')
            ->assertJsonPath('invitation.canResend', true);

        $this->assertStringContainsString('mailbox unavailable', Invitation::first()->last_error);
    }
}
