<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Socialite\Contracts\Factory as Socialite;
use Tests\TestCase;

/**
 * Sign in with Apple: the web flow, the iOS app's own sheet, and the revoking
 * Apple requires when an account goes. Apple is faked at the HTTP layer with
 * keys made here, so the real signing and verifying code runs.
 */
class AppleSignInTest extends TestCase
{
    use RefreshDatabase;

    private const SUB = '001234.5f2a9c.0420';

    private string $applePrivateKey;

    private array $jwks;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        // Our side: the .p8 the client secret is signed with.
        $ec = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        openssl_pkey_export($ec, $ecPem);

        config([
            'services.apple.client_id' => 'com.tmantoinelaw.portal.web',
            'services.apple.team_id' => 'TEAM123456',
            'services.apple.key_id' => 'KEY1234567',
            'services.apple.private_key' => $ecPem,
            'services.apple.bundle_id' => 'com.tmantoinelaw.portal',
            'services.apple.redirect' => 'http://localhost/auth/social/apple/callback',
        ]);

        // Apple's side: the key its ID tokens are signed with, and the JWKS
        // it publishes for it.
        $rsa = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        openssl_pkey_export($rsa, $rsaPem);
        $this->applePrivateKey = $rsaPem;
        $details = openssl_pkey_get_details($rsa)['rsa'];
        $this->jwks = ['keys' => [[
            'kty' => 'RSA', 'kid' => 'apple-test', 'use' => 'sig', 'alg' => 'RS256',
            'n' => self::base64url($details['n']), 'e' => self::base64url($details['e']),
        ]]];
    }

    public function test_the_buttons_only_show_once_apple_is_configured(): void
    {
        config(['services.apple.client_id' => null]);
        $this->get(route('login'))->assertOk()->assertDontSee('Sign in with Apple');

        config(['services.apple.client_id' => 'com.tmantoinelaw.portal.web']);
        $this->get(route('login'))->assertOk()->assertSee('Sign in with Apple');
    }

    public function test_the_redirect_asks_apple_for_name_and_email_by_form_post(): void
    {
        $location = $this->get('/auth/social/apple/redirect')->assertRedirect()->headers->get('Location');

        $this->assertStringStartsWith('https://appleid.apple.com/auth/authorize?', $location);
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame('com.tmantoinelaw.portal.web', $query['client_id']);
        $this->assertSame('http://localhost/auth/social/apple/callback', $query['redirect_uri']);
        $this->assertSame('name email', $query['scope']);
        $this->assertSame('form_post', $query['response_mode']);
        $this->assertNotEmpty($query['state']);
        $this->assertArrayNotHasKey('prompt', $query);
    }

    public function test_apples_form_post_comes_back_as_a_get_without_a_session(): void
    {
        $response = $this->post('/auth/social/apple/callback', [
            'code' => 'c0de', 'state' => 'st4te', 'user' => '{"name":{"firstName":"Bruce"}}', 'id_token' => 'dropped',
        ]);

        // No CSRF token was sent and none is wanted: Apple cannot send one.
        $response->assertStatus(303);
        parse_str((string) parse_url($response->headers->get('Location'), PHP_URL_QUERY), $query);
        $this->assertStringStartsWith('http://localhost/auth/social/apple/callback?', $response->headers->get('Location'));
        $this->assertSame(['code' => 'c0de', 'state' => 'st4te', 'user' => '{"name":{"firstName":"Bruce"}}'], $query);

        // The whole point: no Set-Cookie to overwrite the visitor's session.
        $this->assertSame([], $response->headers->getCookies());
    }

    public function test_a_new_person_signs_up_with_apple_on_the_web(): void
    {
        $this->fakeApple();
        $state = $this->startWebFlow();

        $this->get('/auth/social/apple/callback?'.http_build_query([
            'code' => 'web-code', 'state' => $state,
            'user' => json_encode(['name' => ['firstName' => 'Bruce', 'lastName' => 'Wayne'], 'email' => 'bruce@wayne.test']),
        ]))->assertRedirect();

        $user = User::where('email', 'bruce@wayne.test')->firstOrFail();
        $this->assertSame('Bruce', $user->first_name);
        $this->assertSame('Wayne', $user->last_name);
        $this->assertSame(User::STATUS_PENDING, $user->status);
        $this->assertNotNull($user->email_verified_at);

        $account = $user->connectedAccount('apple');
        $this->assertSame(self::SUB, $account->provider_id);
        // Kept, encrypted, so it can be revoked at Apple later.
        $this->assertSame('apple-refresh-1', $account->token);
        $this->assertFalse((bool) $account->sync_email);

        // The client secret is a JWT signed with our key, for the Services ID.
        Http::assertSent(function (HttpRequest $request) {
            if ($request->url() !== 'https://appleid.apple.com/auth/token') {
                return false;
            }
            [$header, $claims] = $this->jwtParts($request['client_secret']);

            return $request['client_id'] === 'com.tmantoinelaw.portal.web'
                && $request['code'] === 'web-code'
                && $request['redirect_uri'] === 'http://localhost/auth/social/apple/callback'
                && $header['alg'] === 'ES256' && $header['kid'] === 'KEY1234567'
                && $claims['iss'] === 'TEAM123456' && $claims['sub'] === 'com.tmantoinelaw.portal.web'
                && $claims['aud'] === 'https://appleid.apple.com';
        });
    }

    public function test_an_existing_portal_user_is_matched_by_their_apple_email(): void
    {
        $user = $this->member('bruce@wayne.test');
        $this->fakeApple();
        $state = $this->startWebFlow();

        $this->get('/auth/social/apple/callback?code=web-code&state='.$state)->assertRedirect();

        $this->assertAuthenticatedAs($user);
        $this->assertSame(self::SUB, $user->fresh()->connectedAccount('apple')->provider_id);
        $this->assertSame(1, User::count());
    }

    public function test_a_hidden_relay_address_signs_in_the_account_it_is_linked_to(): void
    {
        $user = $this->member('bruce@wayne.test');
        $user->connectedAccounts()->create(['provider' => 'apple', 'provider_id' => self::SUB, 'email' => 'x7k2@privaterelay.appleid.com']);
        $this->fakeApple(['email' => 'x7k2@privaterelay.appleid.com', 'is_private_email' => 'true']);
        $state = $this->startWebFlow();

        $this->get('/auth/social/apple/callback?code=web-code&state='.$state)->assertRedirect();

        $this->assertAuthenticatedAs($user);
        $this->assertSame(1, User::count());
    }

    public function test_an_id_token_issued_to_another_app_is_refused(): void
    {
        $this->fakeApple(['aud' => 'com.someone.else']);
        $state = $this->startWebFlow();

        $this->get('/auth/social/apple/callback?code=web-code&state='.$state)
            ->assertRedirect(route('login'))
            ->assertSessionHas('social_error', "Sign-in with Apple didn't complete. Please try again.");

        $this->assertGuest();
        $this->assertSame(0, User::count());
    }

    public function test_closing_apples_sheet_says_cancelled(): void
    {
        $this->get('/auth/social/apple/callback?error=user_cancelled_authorize')
            ->assertRedirect(route('login'))
            ->assertSessionHas('social_error', 'Apple sign-in was cancelled - nothing was changed.');
    }

    public function test_the_ios_app_signs_in_with_its_own_sheet(): void
    {
        $user = $this->member('bruce@wayne.test');
        $nonce = 'raw-nonce-from-the-app-0123456789';
        $this->fakeApple(['aud' => 'com.tmantoinelaw.portal', 'nonce' => hash('sha256', $nonce)]);

        $response = $this->postJson('/auth/social/apple/native', [
            'identity_token' => $this->idToken(['aud' => 'com.tmantoinelaw.portal', 'nonce' => hash('sha256', $nonce)]),
            'authorization_code' => 'native-code',
            'nonce' => $nonce,
        ])->assertOk();

        // Wherever sign-in leads next (here the stay-signed-in question), not
        // back to the sign-in page.
        $this->assertStringStartsWith(url('/'), $response->json('redirect'));
        $this->assertNotSame(route('login'), $response->json('redirect'));
        $this->assertAuthenticatedAs($user);
        $this->assertSame('apple-refresh-1', $user->fresh()->connectedAccount('apple')->token);

        // The app's code is redeemed as the app: the bundle ID, no redirect.
        Http::assertSent(fn (HttpRequest $request) => $request->url() === 'https://appleid.apple.com/auth/token'
            && $request['client_id'] === 'com.tmantoinelaw.portal'
            && ! isset($request['redirect_uri']));
    }

    public function test_the_ios_app_passes_the_name_apple_gave_it(): void
    {
        $nonce = 'raw-nonce-from-the-app-0123456789';
        $this->fakeApple(['aud' => 'com.tmantoinelaw.portal', 'nonce' => hash('sha256', $nonce), 'email' => 'selina@kyle.test']);

        $this->postJson('/auth/social/apple/native', [
            'identity_token' => $this->idToken(['aud' => 'com.tmantoinelaw.portal', 'nonce' => hash('sha256', $nonce), 'email' => 'selina@kyle.test']),
            'nonce' => $nonce,
            'given_name' => 'Selina',
            'family_name' => 'Kyle',
        ])->assertOk();

        $user = User::where('email', 'selina@kyle.test')->firstOrFail();
        $this->assertSame('Selina', $user->first_name);
        $this->assertSame('Kyle', $user->last_name);
    }

    public function test_a_native_token_from_a_different_sign_in_is_refused(): void
    {
        $this->member('bruce@wayne.test');
        $this->fakeApple();

        $this->postJson('/auth/social/apple/native', [
            'identity_token' => $this->idToken(['aud' => 'com.tmantoinelaw.portal', 'nonce' => hash('sha256', 'someone-elses-nonce-000000')]),
            'nonce' => 'raw-nonce-from-the-app-0123456789',
        ])->assertOk()->assertJson(['redirect' => route('login')]);

        $this->assertGuest();
    }

    public function test_disconnecting_apple_revokes_it_at_apple(): void
    {
        $user = $this->member('bruce@wayne.test');
        $user->connectedAccounts()->create(['provider' => 'apple', 'provider_id' => self::SUB, 'email' => 'bruce@wayne.test', 'token' => 'apple-refresh-1']);
        $this->fakeApple();

        $this->actingAs($user)->postJson('/auth/social/apple/disconnect')->assertOk();

        $this->assertNull($user->fresh()->connectedAccount('apple'));
        Http::assertSent(fn (HttpRequest $request) => $request->url() === 'https://appleid.apple.com/auth/revoke'
            && $request['token'] === 'apple-refresh-1'
            && $request['token_type_hint'] === 'refresh_token');
    }

    public function test_erasing_the_account_revokes_it_at_apple(): void
    {
        $this->member('alfred@wayne.test'); // the firm keeps an administrator
        $user = $this->member('bruce@wayne.test');
        $user->connectedAccounts()->create(['provider' => 'apple', 'provider_id' => self::SUB, 'email' => 'bruce@wayne.test', 'token' => 'apple-refresh-1']);
        $this->fakeApple();

        $this->actingAs($user)->postJson('/me/privacy/erasure', ['confirm' => 'DELETE'])->assertOk();

        $this->assertSame(0, ConnectedAccount::where('user_id', $user->id)->count());
        Http::assertSent(fn (HttpRequest $request) => $request->url() === 'https://appleid.apple.com/auth/revoke'
            && $request['token'] === 'apple-refresh-1');
    }

    public function test_the_security_page_offers_apple_and_the_mailbox_list_leaves_it_out(): void
    {
        $user = $this->member('bruce@wayne.test');
        $user->connectedAccounts()->create(['provider' => 'apple', 'provider_id' => self::SUB, 'email' => 'bruce@wayne.test']);

        $this->actingAs($user)->getJson('/security-settings/data')
            ->assertOk()
            ->assertJsonPath('appleAvailable', true)
            ->assertJsonPath('apple.connected', true)
            ->assertJsonPath('apple.email', 'bruce@wayne.test');

        $this->actingAs($user)->getJson('/portal/mail/settings')
            ->assertOk()
            ->assertJsonPath('accounts', []);
    }

    private function member(string $email): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** Starts the web flow and returns the state Apple would hand back. */
    private function startWebFlow(): string
    {
        $location = $this->get('/auth/social/apple/redirect')->headers->get('Location');
        parse_str((string) parse_url((string) $location, PHP_URL_QUERY), $query);

        // Socialite keeps the driver it built for the first request, request
        // and all; a real callback is a new request with a new driver.
        app(Socialite::class)->forgetDrivers();

        return (string) $query['state'];
    }

    private function fakeApple(array $claims = []): void
    {
        Http::fake([
            'appleid.apple.com/auth/keys' => Http::response($this->jwks),
            'appleid.apple.com/auth/token' => Http::response([
                'access_token' => 'apple-access', 'token_type' => 'Bearer', 'expires_in' => 3600,
                'refresh_token' => 'apple-refresh-1',
                'id_token' => $this->idToken($claims),
            ]),
            'appleid.apple.com/auth/revoke' => Http::response('', 200),
        ]);
    }

    private function idToken(array $claims = []): string
    {
        return JWT::encode(array_merge([
            'iss' => 'https://appleid.apple.com',
            'aud' => 'com.tmantoinelaw.portal.web',
            'iat' => time(),
            'exp' => time() + 600,
            'sub' => self::SUB,
            'email' => 'bruce@wayne.test',
            'email_verified' => 'true',
        ], $claims), $this->applePrivateKey, 'RS256', 'apple-test');
    }

    /** @return array{0: array<string, mixed>, 1: array<string, mixed>} */
    private function jwtParts(string $jwt): array
    {
        [$header, $claims] = explode('.', $jwt);
        $decode = fn (string $part) => json_decode(base64_decode(strtr($part, '-_', '+/')), true);

        return [$decode($header), $decode($claims)];
    }

    private static function base64url(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }
}
