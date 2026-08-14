<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Security\SecurityAlertPolicy;
use App\Support\SecurityPolicies;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Login;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Account settings > Security > Security alert settings.
 *
 * The screen this replaced offered four alerts, three of which the portal has
 * no way to detect — no geo-IP, no malware scanner. These cover the two that
 * are real, and mostly guard the thing that made the old page a lie: that
 * switching an alert on actually produces a notification.
 */
class SecurityAlertPolicyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();
        Cache::flush();
    }

    private function user(string $type, string $name = 'Someone'): User
    {
        return User::factory()->create([
            'name' => $name,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function setPolicy(array $overrides): void
    {
        SecurityPolicies::put('alerts', array_merge(SecurityPolicies::DEFAULTS['alerts'], $overrides));
        Cache::forget('portal-settings.alerts');
    }

    private function firmAlerts(User $admin): int
    {
        return \DB::table('portal_notifications')
            ->where('user_id', $admin->id)
            ->where('type', 'security.firm_alert')
            ->count();
    }

    /* ── defaults ────────────────────────────────────────────────────── */

    public function test_new_device_alerts_do_not_page_administrators_by_default(): void
    {
        // On a small firm every new laptop would page them, and an alert
        // nobody reads is worse than no alert.
        $this->assertFalse(SecurityAlertPolicy::notifiesAdmins('newDevice'));
        $this->assertTrue(SecurityAlertPolicy::notifiesAdmins('failedSignIns'));
    }

    /* ── new-device fan-out ──────────────────────────────────────────── */

    public function test_a_new_device_sign_in_tells_administrators_when_switched_on(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $employee = $this->user(Role::EMPLOYEE, 'Eve');
        $this->setPolicy(['newDevice' => ['admins' => true]]);

        // A first-ever login is expected; the alert is for a returning account.
        AuthEvent::create([
            'user_id' => $employee->id, 'event' => 'login',
            'ip' => '10.0.0.1', 'user_agent' => 'OldBrowser', 'created_at' => now()->subDay(),
        ]);

        Event::dispatch(new Login('web', $employee, false));

        $this->assertSame(1, $this->firmAlerts($admin));
    }

    public function test_a_new_device_sign_in_stays_quiet_while_switched_off(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $employee = $this->user(Role::EMPLOYEE, 'Eve');
        $this->setPolicy(['newDevice' => ['admins' => false]]);

        AuthEvent::create([
            'user_id' => $employee->id, 'event' => 'login',
            'ip' => '10.0.0.1', 'user_agent' => 'OldBrowser', 'created_at' => now()->subDay(),
        ]);

        Event::dispatch(new Login('web', $employee, false));

        $this->assertSame(0, $this->firmAlerts($admin));
    }

    public function test_an_administrator_is_not_told_twice_about_their_own_sign_in(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $this->setPolicy(['newDevice' => ['admins' => true]]);

        AuthEvent::create([
            'user_id' => $admin->id, 'event' => 'login',
            'ip' => '10.0.0.1', 'user_agent' => 'OldBrowser', 'created_at' => now()->subDay(),
        ]);

        Event::dispatch(new Login('web', $admin, false));

        // They already got the personal alert; sending both makes each easier
        // to ignore.
        $this->assertSame(0, $this->firmAlerts($admin));
    }

    /* ── failed sign-ins ─────────────────────────────────────────────── */

    public function test_repeated_failures_alert_once_at_the_threshold(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $employee = $this->user(Role::EMPLOYEE, 'Eve');
        $this->setPolicy(['failedSignIns' => ['admins' => true], 'failedSignInThreshold' => 3]);

        for ($i = 0; $i < 6; $i++) {
            Event::dispatch(new Failed('web', $employee, ['email' => $employee->email]));
        }

        // Once, at the third — not on every attempt after it, which is how a
        // real warning ends up filtered into a folder nobody opens.
        $this->assertSame(1, $this->firmAlerts($admin));
    }

    public function test_failures_below_the_threshold_are_quiet(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $employee = $this->user(Role::EMPLOYEE, 'Eve');
        $this->setPolicy(['failedSignIns' => ['admins' => true], 'failedSignInThreshold' => 5]);

        for ($i = 0; $i < 4; $i++) {
            Event::dispatch(new Failed('web', $employee, ['email' => $employee->email]));
        }

        $this->assertSame(0, $this->firmAlerts($admin));
    }

    public function test_old_failures_fall_out_of_the_window(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $employee = $this->user(Role::EMPLOYEE, 'Eve');
        $this->setPolicy(['failedSignIns' => ['admins' => true], 'failedSignInThreshold' => 3]);

        // Two failures from yesterday must not push today's first over the line.
        for ($i = 0; $i < 2; $i++) {
            AuthEvent::create([
                'user_id' => $employee->id, 'event' => 'login_failed',
                'ip' => '10.0.0.1', 'user_agent' => 'x', 'created_at' => now()->subDay(),
            ]);
        }

        Event::dispatch(new Failed('web', $employee, ['email' => $employee->email]));

        $this->assertSame(0, $this->firmAlerts($admin));
    }

    /* ── the settings endpoint ───────────────────────────────────────── */

    public function test_an_administrator_can_save_the_alert_settings(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');

        $this->actingAs($admin)->putJson('/admin/security-policies/alerts', [
            'newDevice' => ['admins' => true],
            'failedSignIns' => ['admins' => false],
            'failedSignInThreshold' => 10,
            'alternateContacts' => 'security@firm.test, ops@firm.test',
        ])->assertOk();

        Cache::forget('portal-settings.alerts');

        $this->assertTrue(SecurityAlertPolicy::notifiesAdmins('newDevice'));
        $this->assertFalse(SecurityAlertPolicy::notifiesAdmins('failedSignIns'));
        $this->assertSame(10, SecurityAlertPolicy::failureThreshold());
        $this->assertSame(['security@firm.test', 'ops@firm.test'], SecurityAlertPolicy::alternateContacts());
    }

    public function test_a_mistyped_alternate_contact_names_itself(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');

        // Silently dropping it later would leave somebody believing they had
        // set up an alert that never arrives.
        $this->actingAs($admin)->putJson('/admin/security-policies/alerts', [
            'newDevice' => ['admins' => true],
            'failedSignIns' => ['admins' => true],
            'failedSignInThreshold' => 5,
            'alternateContacts' => 'security@firm.test, not-an-email',
        ])->assertStatus(422);
    }

    public function test_the_threshold_is_bounded(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');

        $this->actingAs($admin)->putJson('/admin/security-policies/alerts', [
            'newDevice' => ['admins' => true],
            'failedSignIns' => ['admins' => true],
            'failedSignInThreshold' => 1,
            'alternateContacts' => '',
        ])->assertStatus(422);
    }

    public function test_only_administrators_can_change_the_alert_settings(): void
    {
        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $type) {
            $this->actingAs($this->user($type))->putJson('/admin/security-policies/alerts', [
                'newDevice' => ['admins' => true],
                'failedSignIns' => ['admins' => true],
                'failedSignInThreshold' => 5,
                'alternateContacts' => '',
            ])->assertForbidden();
        }
    }

    public function test_the_screen_is_only_offered_events_the_portal_can_detect(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');

        $events = $this->actingAs($admin)->getJson('/admin/security-policies')
            ->assertOk()
            ->json('alertEvents');

        // The old page offered "signs in from a different country" and "a
        // suspicious file is uploaded". There is no geo-IP lookup and no
        // scanner behind either, so they must not come back.
        $this->assertSame(['newDevice', 'failedSignIns'], array_column($events, 'id'));
    }
}
