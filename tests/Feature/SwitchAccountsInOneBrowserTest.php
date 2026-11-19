<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\AuthEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * One person, two accounts, one browser: sign in as A, sign out the way the
 * portal's Sign out button does, open the sign-in page, sign in as B. The
 * browser must be B, never A.
 *
 * Reported in November 2026 as "signing back in puts me in the previous
 * account". Unlike the other auth tests, every request here carries the
 * cookies earlier responses set, as a real browser does (session, remember
 * me, "Stay signed in" answer, trusted device), the guard is forgotten
 * between requests as it is between PHP processes, and sessions use the
 * database handler production runs on.
 */
class SwitchAccountsInOneBrowserTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string, string> cookie name => value exactly as the server sent it */
    private array $jar = [];

    protected function setUp(): void
    {
        parent::setUp();

        config(['session.driver' => 'database']);

        Route::middleware('web')->get('/__test/whoami', fn () => response()->json(['id' => auth()->id()]));
    }

    private function person(string $email): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
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

    private function whoami(): ?int
    {
        return $this->browse('GET', '/__test/whoami', [], true)->json('id');
    }

    private function submitPassword(User $user): TestResponse
    {
        return $this->browse('POST', '/auth/login', ['email' => $user->email, 'password' => 'password']);
    }

    /** sign-out.js: a JSON POST, answered 204, then the sign-in page. */
    private function signOutLikeThePortal(): void
    {
        $this->browse('POST', '/auth/logout', [], true)->assertNoContent();
        $this->assertNull($this->whoami(), 'after signing out the browser should be signed in as nobody');

        $this->browse('GET', '/auth/login?from=logout')->assertOk();
    }

    /** The six-digit code in the newest sign-in email sent to this person. */
    private function codeSentTo(User $user): string
    {
        $mail = Mail::sent(Postcard::class)->filter(fn (Postcard $m) => $m->hasTo($user->email))->last();
        $this->assertNotNull($mail, 'no sign-in code email was sent to '.$user->email);

        $code = null;
        array_walk_recursive($mail->payload, function ($value, $key) use (&$code) {
            if ($key === 'code' && is_string($value) && preg_match('/^\d{6}$/', $value)) {
                $code = $value;
            }
        });
        $this->assertNotNull($code, 'the sign-in email carried no six-digit code');

        return $code;
    }

    /** @return array<string, array{string}> */
    public static function stayAnswers(): array
    {
        return ['stay signed in: yes' => ['yes'], 'stay signed in: no' => ['no']];
    }

    #[DataProvider('stayAnswers')]
    public function test_signing_in_as_the_second_account_after_signing_out_lands_in_it(string $stay): void
    {
        $first = $this->person('first@example.test');
        $second = $this->person('second@example.test');

        $this->browse('GET', '/auth/login');
        $this->submitPassword($first)->assertRedirect(route('stay-signed-in.show'));
        $this->browse('POST', '/auth/stay-signed-in', ['stay' => $stay]);
        $this->assertSame($first->id, $this->whoami());

        $this->signOutLikeThePortal();
        $this->submitPassword($second);

        $this->assertSame($second->id, $this->whoami());
    }

    /**
     * Both have signed in before, so on a browser not yet trusted for that
     * account each sign-in confirms with an email code. The parked half of
     * the sign-in must belong to whoever typed their details this time.
     */
    #[DataProvider('stayAnswers')]
    public function test_the_email_code_step_finishes_the_account_that_was_entered(string $stay): void
    {
        Mail::fake();
        $first = $this->person('first@example.test');
        $second = $this->person('second@example.test');
        foreach ([$first, $second] as $person) {
            AuthEvent::query()->forceCreate([
                'user_id' => $person->id,
                'event' => 'login',
                'ip' => '203.0.113.9',
                'created_at' => now()->subDays(3),
            ]);
        }

        $this->browse('GET', '/auth/login');
        $this->submitPassword($first)->assertRedirect(route('login-code.show'));
        $this->browse('POST', '/auth/login-code', ['code' => $this->codeSentTo($first)]);
        $this->browse('POST', '/auth/stay-signed-in', ['stay' => $stay]);
        $this->assertSame($first->id, $this->whoami());

        $this->signOutLikeThePortal();
        $this->submitPassword($second)->assertRedirect(route('login-code.show'));
        $this->browse('POST', '/auth/login-code', ['code' => $this->codeSentTo($second)]);

        $this->assertSame($second->id, $this->whoami());
    }
}
