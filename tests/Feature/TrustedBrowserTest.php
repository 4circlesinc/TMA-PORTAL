<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\AuthEvent;
use App\Models\TrustedDevice;
use App\Models\User;
use App\Support\TrustedDevices;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * "Trust this browser" on the code screen means the next sign-in from this
 * browser skips the code, for every account that ticked it here.
 *
 * Reported in November 2026: one person with two accounts was asked for the
 * code every time despite trusting the browser. The cookie held one token, and
 * trusting the browser for the second account replaced the first account's
 * token, so the two kept un-trusting each other.
 *
 * Every request carries the cookies earlier responses set, as a browser does.
 */
class TrustedBrowserTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string, string> */
    private array $jar = [];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function person(string $email): User
    {
        $user = User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        // Signed in before (elsewhere), so a browser it does not trust asks for a code.
        AuthEvent::query()->forceCreate([
            'user_id' => $user->id,
            'event' => 'login',
            'ip' => '198.51.100.7',
            'created_at' => now()->subDays(3),
        ]);

        return $user;
    }

    private function browse(string $method, string $uri, array $data = [], bool $json = false): TestResponse
    {
        $this->app['auth']->forgetGuards();
        $server = $json
            ? ['HTTP_ACCEPT' => 'application/json', 'HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest']
            : ['HTTP_ACCEPT' => 'text/html'];

        $response = $this->call($method, $uri, $data, $this->jar, [], $server);

        foreach ($response->headers->getCookies() as $cookie) {
            $expired = $cookie->getExpiresTime() !== 0 && $cookie->getExpiresTime() < time();
            if ($expired || $cookie->getValue() === null || $cookie->getValue() === '') {
                unset($this->jar[$cookie->getName()]);
            } else {
                $this->jar[$cookie->getName()] = $cookie->getValue();
            }
        }

        return $response;
    }

    private function submitPassword(User $user): TestResponse
    {
        $this->browse('GET', '/auth/login');

        return $this->browse('POST', '/auth/login', ['email' => $user->email, 'password' => 'password']);
    }

    /** Enter the code emailed to this person, ticking "Trust this browser". */
    private function enterCodeAndTrust(User $user): TestResponse
    {
        $mail = Mail::sent(Postcard::class)->filter(fn (Postcard $m) => $m->hasTo($user->email))->last();
        $this->assertNotNull($mail, 'no sign-in code email was sent to '.$user->email);

        $code = null;
        array_walk_recursive($mail->payload, function ($value, $key) use (&$code) {
            if ($key === 'code' && is_string($value) && preg_match('/^\d{6}$/', $value)) {
                $code = $value;
            }
        });

        return $this->browse('POST', '/auth/login-code', ['code' => $code, 'trust_device' => '1'])
            ->assertRedirect();
    }

    private function signOut(): void
    {
        $this->browse('POST', '/auth/logout', [], true)->assertNoContent();
    }

    public function test_a_trusted_browser_is_not_asked_for_a_code_next_time(): void
    {
        $user = $this->person('first@example.test');

        $this->submitPassword($user)->assertRedirect(route('login-code.show'));
        $this->enterCodeAndTrust($user);
        $this->signOut();

        $this->submitPassword($user)->assertRedirect('/');
    }

    public function test_two_accounts_can_both_trust_the_same_browser(): void
    {
        $first = $this->person('first@example.test');
        $second = $this->person('second@example.test');

        $this->submitPassword($first)->assertRedirect(route('login-code.show'));
        $this->enterCodeAndTrust($first);
        $this->signOut();

        $this->submitPassword($second)->assertRedirect(route('login-code.show'));
        $this->enterCodeAndTrust($second);
        $this->signOut();

        // Neither trust undid the other.
        $this->submitPassword($first)->assertRedirect('/');
        $this->signOut();
        $this->submitPassword($second)->assertRedirect('/');
    }

    public function test_trusting_the_browser_for_one_account_does_not_trust_it_for_another(): void
    {
        $first = $this->person('first@example.test');
        $second = $this->person('second@example.test');

        $this->submitPassword($first)->assertRedirect(route('login-code.show'));
        $this->enterCodeAndTrust($first);
        $this->signOut();

        $this->submitPassword($second)->assertRedirect(route('login-code.show'));
    }

    public function test_removing_the_browser_from_one_account_leaves_the_other_trusted(): void
    {
        $first = $this->person('first@example.test');
        $second = $this->person('second@example.test');
        foreach ([$first, $second] as $person) {
            $this->submitPassword($person)->assertRedirect(route('login-code.show'));
            $this->enterCodeAndTrust($person);
            $this->signOut();
        }

        $first->trustedDevices()->delete();

        $this->submitPassword($first)->assertRedirect(route('login-code.show'));

        // Abandon that half-finished sign-in: keep only the browser's trust cookie.
        $this->jar = array_intersect_key($this->jar, [TrustedDevices::COOKIE => true]);
        $this->submitPassword($second)->assertRedirect('/');
    }

    /** Rows written before the token was scoped to the account still count. */
    public function test_a_browser_trusted_before_this_change_is_still_trusted(): void
    {
        $user = $this->person('first@example.test');
        $token = Str::random(64);
        TrustedDevice::query()->forceCreate([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(7),
        ]);

        $request = request()->duplicate(cookies: [TrustedDevices::COOKIE => $token]);

        $this->assertTrue(TrustedDevices::trusts($user, $request));
    }
}
