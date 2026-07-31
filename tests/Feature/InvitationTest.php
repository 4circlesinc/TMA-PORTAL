<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\ActivityLog;
use App\Models\Client;
use App\Models\Company;
use App\Models\EmailDelivery;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Mail\Postcards;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The invitation backbone, end to end: issuing, sending, the public accept
 * screen in each of its states, and the management actions.
 */
class InvitationTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return $this->staff('Administrator');
    }

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
            'uid' => 'acme-co',
            'name' => 'Acme Co',
            'email' => 'owner@acme.test',
            'initial' => 'A',
            'initial_color' => 'blue',
            'data' => [],
        ], $o));
    }

    /** Send an invite for a client and return the plaintext token from the email. */
    private function inviteAndCaptureToken(Client $client, User $by): string
    {
        $token = null;
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $token = $m[1];
            }

            return true;
        });

        return $token;
    }

    // ---------------------------------------------------------------- issuing

    public function test_staff_can_invite_a_client_and_the_email_carries_a_working_link(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")
            ->assertOk()
            ->assertJsonPath('status', 'ok')
            // Queued, not yet handed to a transport — see the queued-vs-sent test.
            ->assertJsonPath('invitation.status', 'pending');

        $invitation = Invitation::first();
        $this->assertNotNull($invitation);
        $this->assertSame('client', $invitation->type);
        $this->assertSame('owner@acme.test', $invitation->email);
        $this->assertSame(1, $invitation->send_count);

        $token = $this->inviteAndCaptureToken($client, $staff);
        $this->assertNotNull($token, 'the invitation email had no /invite/ link');

        // The link works for a logged-out visitor.
        $this->get("/invite/{$token}")->assertOk()->assertSee('Create your account');
    }

    public function test_the_token_is_never_stored_in_plain_text(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");

        $token = $this->inviteAndCaptureToken($client, $staff);
        $invitation = Invitation::first();

        $this->assertNotSame($token, $invitation->token_hash);
        $this->assertSame(hash('sha256', $token), $invitation->token_hash);

        // The plaintext appears in no column of the row.
        foreach ($invitation->getAttributes() as $value) {
            if (is_string($value)) {
                $this->assertStringNotContainsString($token, $value);
            }
        }
    }

    public function test_the_invitation_screen_shows_the_inviter_organisation_and_access(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $staff->forceFill(['name' => 'Dana Reed'])->save();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('Dana Reed')
            // The firm's name, not APP_NAME — which is "tma-portal" in production.
            ->assertSee(Postcards::site())
            ->assertSee('Client portal access')
            ->assertSee('owner@acme.test');
    }

    // -------------------------------------------------------------- accepting

    public function test_accepting_creates_the_account_and_links_the_client(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!',
            'password_confirmation' => 'sup3rsecret!',
            'terms' => '1',
        ])->assertRedirect('/');

        $user = User::where('email', 'owner@acme.test')->first();
        $this->assertNotNull($user);
        $this->assertSame('Client', $user->account_type);
        $this->assertSame('approved', $user->status);
        $this->assertSame($user->id, $client->fresh()->user_id);

        $invitation = Invitation::first();
        $this->assertSame('accepted', $invitation->status);
        $this->assertNotNull($invitation->accepted_at);
        $this->assertSame($user->id, $invitation->accepted_user_id);
        $this->assertAuthenticatedAs($user);
    }

    public function test_the_terms_box_is_required(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->from("/invite/{$token}")->post("/invite/{$token}", [
            'password' => 'sup3rsecret!',
            'password_confirmation' => 'sup3rsecret!',
        ])->assertSessionHasErrors('terms');

        $this->assertDatabaseCount('users', 1);
    }

    public function test_an_accepted_link_says_so_and_cannot_create_a_second_account(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ]);

        $this->app['auth']->forgetGuards();

        $this->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('This invitation has already been accepted');

        // A replay of the POST creates nothing.
        $before = User::count();
        $this->post("/invite/{$token}", [
            'password' => 'another1!', 'password_confirmation' => 'another1!', 'terms' => '1',
        ]);
        $this->assertSame($before, User::count());
    }

    public function test_an_expired_link_says_expired(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        Invitation::first()->forceFill(['expires_at' => now()->subDay()])->save();

        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('This invitation has expired')
            ->assertSee('Please request a new invitation');

        // Opening it flips the stored status, so the management screen agrees.
        $this->assertSame('expired', Invitation::first()->status);
    }

    public function test_a_cancelled_link_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $admin);
        $uuid = Invitation::first()->uuid;

        $this->actingAs($admin)->postJson("/portal/invitations/{$uuid}/cancel")->assertOk();

        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$token}")->assertOk()->assertSee('withdrawn');

        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ]);
        $this->assertDatabaseMissing('users', ['email' => 'owner@acme.test']);
    }

    public function test_a_garbage_token_gets_a_real_page_not_a_silent_redirect(): void
    {
        $this->get('/invite/deadbeefdeadbeef')
            ->assertOk()
            ->assertSee('This invitation link', false)
            ->assertSee('may have been replaced by a newer invitation');
    }

    // ------------------------------------------------- existing user (Phase 6)

    public function test_an_invited_address_that_already_has_an_account_is_asked_to_sign_in(): void
    {
        Mail::fake();
        $staff = $this->staff();
        User::factory()->create(['email' => 'owner@acme.test', 'status' => 'approved']);
        $client = $this->client();

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('already has an account')
            ->assertSee('Sign in to accept');

        // And registering is refused outright.
        $before = User::count();
        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ]);
        $this->assertSame($before, User::count(), 'a duplicate account was created');
    }

    public function test_an_existing_user_accepts_by_signing_in_without_a_duplicate_account(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $existing = User::factory()->create([
            'email' => 'owner@acme.test',
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $client = $this->client();

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $countBefore = User::count();

        $this->actingAs($existing)->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('Accept invitation');

        $this->actingAs($existing)->post("/invite/{$token}/accept")->assertRedirect('/');

        $this->assertSame($countBefore, User::count());
        $this->assertSame($existing->id, $client->fresh()->user_id);
        $this->assertSame('accepted', Invitation::first()->status);
        $this->assertSame($existing->id, Invitation::first()->accepted_user_id);
    }

    public function test_signing_in_as_the_wrong_person_cannot_accept(): void
    {
        Mail::fake();
        $staff = $this->staff();
        User::factory()->create(['email' => 'owner@acme.test', 'status' => 'approved']);
        $someoneElse = $this->staff();
        $client = $this->client();

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->actingAs($someoneElse)->get("/invite/{$token}")
            ->assertOk()
            ->assertSee('signed in as someone else');

        $this->actingAs($someoneElse)->post("/invite/{$token}/accept");

        $this->assertNull($client->fresh()->user_id);
        $this->assertNotSame('accepted', Invitation::first()->status);
    }

    // -------------------------------------------------------- staff (Phase 7)

    public function test_inviting_staff_creates_an_invitation_not_an_account(): void
    {
        Mail::fake();
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/admin/users', [
            'name' => 'Sam Fielding',
            'email' => 'sam@firm.test',
            'account_type' => 'Employee',
            'job_title' => 'Paralegal',
        ])->assertOk();

        // No account until they accept — this is the behaviour change.
        $this->assertDatabaseMissing('users', ['email' => 'sam@firm.test']);

        $invitation = Invitation::first();
        $this->assertSame('staff', $invitation->type);
        $this->assertSame('Employee', $invitation->role);
        $this->assertSame('Paralegal', $invitation->access['jobTitle']);
    }

    public function test_a_staff_invitation_creates_an_employee_on_acceptance(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $this->actingAs($admin)->postJson('/admin/users', [
            'name' => 'Sam Fielding',
            'email' => 'sam@firm.test',
            'account_type' => 'Employee',
        ]);

        $token = null;
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $token = $m[1];
            }

            return true;
        });

        $this->app['auth']->forgetGuards();
        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ])->assertRedirect('/');

        $user = User::where('email', 'sam@firm.test')->first();
        $this->assertNotNull($user);
        $this->assertSame('Employee', $user->account_type);
        $this->assertSame('approved', $user->status);
    }

    public function test_an_employee_cannot_invite_staff(): void
    {
        Mail::fake();
        $employee = $this->staff('Employee');

        $this->actingAs($employee)->postJson('/portal/invitations', [
            'type' => 'staff',
            'email' => 'nope@firm.test',
            'name' => 'Nope',
            'role' => 'Employee',
        ])->assertForbidden();
    }

    public function test_only_an_administrator_can_hand_out_administrator_access(): void
    {
        Mail::fake();
        $employee = $this->staff('Employee');
        $client = $this->client();

        $this->actingAs($employee)->postJson('/portal/invitations', [
            'type' => 'client',
            'email' => 'x@acme.test',
            'clientUid' => $client->uid,
            'role' => 'Administrator',
        ])->assertForbidden();
    }

    // ------------------------------------------------- management (Phase 19)

    public function test_the_management_list_reports_every_status(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite");

        $this->actingAs($admin)->getJson('/portal/invitations')
            ->assertOk()
            ->assertJsonPath('invitations.0.email', 'owner@acme.test')
            ->assertJsonPath('invitations.0.status', 'pending')
            ->assertJsonPath('invitations.0.typeLabel', 'Client')
            ->assertJsonPath('counts.pending', 1);
    }

    public function test_resending_rotates_the_token_and_invalidates_the_old_link(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite");

        $tokens = [];
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$tokens) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $tokens[] = $m[1];
            }

            return true;
        });
        $first = $tokens[0];

        $uuid = Invitation::first()->uuid;
        $this->actingAs($admin)->postJson("/portal/invitations/{$uuid}/resend")->assertOk();

        $tokens = [];
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$tokens) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $tokens[] = $m[1];
            }

            return true;
        });
        $second = end($tokens);

        $this->assertNotSame($first, $second, 'resend reused the old token');
        $this->assertSame(2, Invitation::first()->send_count);
        $this->assertSame(1, Invitation::count(), 'resend created a duplicate invitation');

        // The superseded link is dead.
        $this->app['auth']->forgetGuards();
        $this->get("/invite/{$first}")->assertOk()
            ->assertSee('may have been replaced by a newer invitation');
        $this->get("/invite/{$second}")->assertOk()->assertSee('Create your account');
    }

    public function test_copy_link_returns_a_working_url(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite");
        $uuid = Invitation::first()->uuid;

        $url = $this->actingAs($admin)->postJson("/portal/invitations/{$uuid}/link")
            ->assertOk()->json('url');

        $this->assertStringContainsString('/invite/', $url);

        $this->app['auth']->forgetGuards();
        $this->get($url)->assertOk()->assertSee('Create your account');
    }

    public function test_the_recipient_address_can_be_corrected(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();
        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite");
        $uuid = Invitation::first()->uuid;

        $this->actingAs($admin)->patchJson("/portal/invitations/{$uuid}/recipient", [
            'email' => 'correct@acme.test',
        ])->assertOk()->assertJsonPath('invitation.email', 'correct@acme.test');

        $this->assertSame(1, Invitation::count());
        Mail::assertSent(Postcard::class);
    }

    public function test_a_second_invitation_for_the_same_person_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();

        $this->actingAs($admin)->postJson('/portal/invitations', [
            'type' => 'client', 'email' => 'owner@acme.test', 'clientUid' => $client->uid,
        ])->assertOk();

        $this->actingAs($admin)->postJson('/portal/invitations', [
            'type' => 'client', 'email' => 'owner@acme.test', 'clientUid' => $client->uid,
        ])->assertStatus(422);

        $this->assertSame(1, Invitation::count());
    }

    public function test_inviting_a_client_that_already_has_a_login_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $user = User::factory()->create(['status' => 'approved']);
        $client = $this->client(['user_id' => $user->id]);

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")
            ->assertStatus(422);
    }

    // ------------------------------------------ delivery tracking (Phase 17)

    public function test_a_delivery_row_is_written_and_marked_sent(): void
    {
        // Not faked: the array transport really sends, so MessageSent fires.
        $admin = $this->admin();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        $delivery = EmailDelivery::first();
        $this->assertNotNull($delivery, 'no delivery row was written');
        $this->assertSame('owner@acme.test', $delivery->recipient);
        $this->assertSame('clientInvite', $delivery->template);
        $this->assertSame(Invitation::class, $delivery->related_type);

        // QUEUE_CONNECTION is sync in tests, so it really went out.
        $this->assertSame('sent', $delivery->status);
        $this->assertNotNull($delivery->sent_at);
        $this->assertNotNull($delivery->message_id);
    }

    /**
     * "Sent" must mean a transport accepted the message. Mail::fake() stands in
     * for mail that never reached one, and nothing may claim it did.
     */
    public function test_mail_that_never_reached_a_transport_is_not_reported_as_sent(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        $this->assertSame('pending', Invitation::first()->status);
        $this->assertSame('queued', EmailDelivery::first()->status);

        // It was still handed over, and that is recorded separately.
        $this->assertNotNull(Invitation::first()->last_sent_at);
        $this->assertSame(1, Invitation::first()->send_count);
    }

    public function test_a_send_failure_leaves_the_invitation_live_and_records_the_error(): void
    {
        $admin = $this->admin();
        $client = $this->client();

        // Make the transport fail the way a real outage would.
        Mail::shouldReceive('to->sendNow')->andThrow(new \RuntimeException('SMTP refused the connection'));

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        $invitation = Invitation::first();
        $this->assertSame('failed', $invitation->status);
        $this->assertStringContainsString('SMTP refused', $invitation->last_error);

        // Failed to send, but still acceptable — the link must work if it lands.
        $this->assertTrue($invitation->isAcceptable());
    }

    /**
     * A transport that fails once and then works — exactly what a mailbox
     * mid-provisioning does. The successful attempt has to clear the earlier
     * failure, or the invitation reads "failed" for ever while the recipient
     * is holding a working link.
     */
    public function test_a_successful_resend_clears_an_earlier_failure(): void
    {
        $admin = $this->admin();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();
        $invitation = Invitation::first();

        // The state a refused transport leaves behind (observed in production
        // against a mailbox that was still being provisioned).
        $invitation->forceFill([
            'status' => Invitation::STATUS_FAILED,
            'last_error' => 'Microsoft Graph sendMail failed (404): The mailbox is either inactive…',
            'send_count' => 1,
        ])->save();

        $this->actingAs($admin)->postJson("/portal/invitations/{$invitation->uuid}/resend")->assertOk();

        $invitation->refresh();
        $this->assertSame('sent', $invitation->status, 'a working resend left the invitation failed');
        $this->assertNull($invitation->last_error);
        $this->assertSame(2, $invitation->send_count);
        $this->assertTrue($invitation->isAcceptable());
    }

    // ------------------------------------------- activity logging (Phase 21)

    public function test_sending_and_accepting_are_written_to_the_activity_log(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'client.invitation']);

        $this->app['auth']->forgetGuards();
        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ]);

        $accepted = ActivityLog::where('description', 'like', '%accepted their invitation%')->first();
        $this->assertNotNull($accepted);

        // No invitation token may appear anywhere in the trail.
        foreach (ActivityLog::all() as $row) {
            $this->assertStringNotContainsString($token, json_encode($row->toArray()));
        }
    }

    public function test_the_inviter_is_notified_when_the_invitation_is_accepted(): void
    {
        Mail::fake();
        $staff = $this->staff();
        $client = $this->client();
        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite");
        $token = $this->inviteAndCaptureToken($client, $staff);

        $this->app['auth']->forgetGuards();
        $this->post("/invite/{$token}", [
            'password' => 'sup3rsecret!', 'password_confirmation' => 'sup3rsecret!', 'terms' => '1',
        ]);

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $staff->id,
            'type' => 'client.invitation',
        ]);
    }

    // ------------------------------------------------------- company invites

    public function test_a_client_in_a_company_gets_the_company_invitation_email(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = Company::create(['uid' => 'acme', 'name' => 'Acme Group']);
        $client = $this->client(['company_id' => $company->id]);

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        $invitation = Invitation::first();
        $this->assertSame('company_member', $invitation->type);
        $this->assertSame($company->id, $invitation->company_id);

        Mail::assertSent(Postcard::class, fn (Postcard $mail) => str_contains($mail->subjectLine, 'Acme Group'));
    }

    // -------------------------------------------------------- legacy support

    public function test_the_old_client_invite_url_still_lands_somewhere_useful(): void
    {
        $this->get('/client-invite/sometoken123')
            ->assertRedirect('/invite/sometoken123');
    }
}
