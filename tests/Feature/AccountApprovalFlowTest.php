<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Auth\Events\Registered;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The account approval flow (§16–§19): a new registration alerts the admins,
 * approving or denying notifies the user and audits the action, and the
 * outstanding approval notification clears so it can't be processed twice.
 */
class AccountApprovalFlowTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
    }

    private function pending(): User
    {
        return User::factory()->create(['status' => 'pending', 'account_type' => 'Client', 'name' => 'Newbie Jones']);
    }

    public function test_registration_alerts_admins_and_audits(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();

        event(new Registered($newbie));

        $n = Notification::where('user_id', $admin->id)->where('type', 'account.pending')->first();
        $this->assertNotNull($n);
        $this->assertSame(Notification::LEVEL_APPROVAL, $n->level);
        $this->assertSame('Review Account', $n->action_label);
        $this->assertSame($newbie->id, $n->actor_id);
        $this->assertTrue($n->requiresAction());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.registered')->count());
    }

    public function test_approving_notifies_the_user_clears_the_alert_and_is_audited(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();
        event(new Registered($newbie));

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => Role::REVIEWING_OFFICER])
            ->assertOk();

        $newbie->refresh();
        $this->assertSame('approved', $newbie->status);
        $this->assertSame(Role::REVIEWING_OFFICER, $newbie->account_type);

        // The user is told, and it's audited.
        $this->assertSame(1, Notification::where('user_id', $newbie->id)->where('type', 'account.approved')->count());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.approved')->count());

        // The admin's approval alert is now completed (no longer action-required).
        $alert = Notification::where('user_id', $admin->id)->where('type', 'account.pending')->first();
        $this->assertNotNull($alert->completed_at);
        $this->assertFalse($alert->requiresAction());

        // Pending count is now zero.
        $this->actingAs($admin)->getJson('/admin/users/pending-count')->assertJsonPath('count', 0);
    }

    public function test_a_pending_account_cannot_be_approved_twice(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => Role::REVIEWING_OFFICER])->assertOk();
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => Role::REVIEWING_OFFICER])->assertStatus(422);
    }

    public function test_denying_records_a_reason_notifies_and_clears_the_alert(): void
    {
        $admin = $this->admin();
        $newbie = $this->pending();
        event(new Registered($newbie));

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/deny", ['reason' => 'Unverified organisation'])
            ->assertOk();

        $newbie->refresh();
        $this->assertSame('suspended', $newbie->status);
        $this->assertSame('Unverified organisation', $newbie->admin_note);

        $this->assertSame(1, Notification::where('user_id', $newbie->id)->where('type', 'account.denied')->count());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.denied')->count());

        $alert = Notification::where('user_id', $admin->id)->where('type', 'account.pending')->first();
        $this->assertNotNull($alert->completed_at);

        // A denied (non-pending) account can't be denied again.
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/deny")->assertStatus(422);
    }

    /*
     * The three emails the person outside the portal actually sees. They are
     * sent inline rather than queued, and recorded as deliveries: a queued copy
     * sends nothing at all while no worker is draining the queue, and an
     * unrecorded one leaves nobody able to answer "did it go out?".
     */

    /**
     * The regression the other tests in this file could never catch: they all
     * build their pending user with an explicit `'status' => 'pending'`, so the
     * model always had one. A real signup doesn't pass status at all and relies
     * on the column default — which fills the row but leaves the saved instance
     * NULL, so every `$user->status === STATUS_PENDING` check downstream was
     * false and the whole registration follow-up was skipped.
     */
    public function test_a_newly_created_account_is_pending_on_the_model_not_just_in_the_table(): void
    {
        $user = User::create([
            'name' => 'Newbie Jones',
            'email' => 'newbie@example.com',
            'password' => 'password-that-is-long-enough',
        ]);

        $this->assertSame(User::STATUS_PENDING, $user->status);
        $this->assertTrue($user->status === User::STATUS_PENDING);
        $this->assertSame(User::STATUS_PENDING, $user->fresh()->status);
    }

    public function test_signing_up_through_the_register_form_alerts_admins_and_emails_the_person(): void
    {
        Mail::fake();
        $admin = $this->admin();

        // The real form's fields. Posting a single `name` failed validation
        // silently, so no account was ever created and everything below was
        // asserted against a registration that never happened.
        $this->post('/auth/register', [
            'first_name' => 'Newbie',
            'last_name' => 'Jones',
            'gender' => 'Prefer not to say',
            'email' => 'newbie@example.com',
            'password' => 'password-that-is-long-enough',
            'password_confirmation' => 'password-that-is-long-enough',
            'terms' => 'on',
        ])->assertSessionHasNoErrors();

        $newbie = User::where('email', 'newbie@example.com')->firstOrFail();
        $this->assertSame(User::STATUS_PENDING, $newbie->status);

        $this->assertSame(1, Notification::where('user_id', $admin->id)
            ->where('type', 'account.pending')->count());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.registered')->count());
        Mail::assertSent(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email)
            && $m->subjectLine === 'We\'ve received your request for access');
    }

    public function test_registering_emails_the_person_that_their_request_is_pending(): void
    {
        Mail::fake();
        $this->admin();
        $newbie = $this->pending();

        event(new Registered($newbie));

        Mail::assertSent(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email)
            && $m->subjectLine === 'We\'ve received your request for access');
        // The person's own mail must go INLINE — the queue can't be trusted to
        // deliver it. Admin notification emails may still queue.
        Mail::assertNotQueued(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email));
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => $newbie->email, 'template' => 'accountPending',
        ]);
    }

    public function test_approving_emails_the_welcome_postcard(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $newbie = $this->pending();

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => Role::REVIEWING_OFFICER])
            ->assertOk();

        Mail::assertSent(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email)
            && $m->subjectLine === 'Your account is ready');
        // Inline for the person; admin notification emails may still queue.
        Mail::assertNotQueued(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email));
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => $newbie->email, 'template' => 'welcome',
        ]);
    }

    public function test_denying_emails_the_person_the_decision_and_the_reason(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $newbie = $this->pending();

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/deny", ['reason' => 'Unverified organisation'])
            ->assertOk();

        // A denied account can never sign in, so the in-portal notification is
        // one they will never see — the email is the whole message.
        Mail::assertSent(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email)
            && $m->subjectLine === 'An update on your access request'
            && str_contains($m->render(), 'Unverified organisation'));
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => $newbie->email, 'template' => 'accountDenied',
        ]);
    }

    public function test_non_admins_cannot_approve_or_deny(): void
    {
        $officer = User::factory()->create([
            'status' => 'approved', 'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
        $newbie = $this->pending();

        $this->actingAs($officer)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => Role::REVIEWING_OFFICER])->assertStatus(403);
        $this->actingAs($officer)->postJson("/admin/users/{$newbie->id}/deny")->assertStatus(403);
    }
}
