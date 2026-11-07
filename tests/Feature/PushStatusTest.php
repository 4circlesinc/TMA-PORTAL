<?php

namespace Tests\Feature;

use App\Models\DeviceToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * `push:status` is what gets run from Laravel Cloud to find out whether
 * phones can be reached. It used to know only about Android (FCM), so an
 * iPhone setup could be wrong, or missing, without it saying so.
 */
class PushStatusTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    protected function setUp(): void
    {
        parent::setUp();

        $ec = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        openssl_pkey_export($ec, $pem);

        config([
            'services.fcm.project_id' => null,
            'services.fcm.credentials' => null,
            'services.apns.key_id' => 'APNSKEY123',
            'services.apns.team_id' => 'TEAM123456',
            'services.apns.bundle_id' => 'com.tmantoinelaw.portal',
            'services.apns.private_key' => $pem,
        ]);
    }

    public function test_it_reports_that_apple_accepts_the_key(): void
    {
        Http::fake(['api.push.apple.com/*' => Http::response(['reason' => 'BadDeviceToken'], 400)]);

        $this->artisan('push:status')
            ->expectsOutputToContain('iPhone (APNs)')
            ->expectsOutputToContain('Apple auth:   OK (Apple accepted the key)')
            ->expectsOutputToContain('Google auth:  not set up')
            ->assertExitCode(0);

        // The probe reaches no device: a token of zeros, for the app's topic.
        Http::assertSent(fn (HttpRequest $request) => $request->url() === 'https://api.push.apple.com/3/device/'.str_repeat('0', 64)
            && $request->header('apns-topic')[0] === 'com.tmantoinelaw.portal'
            && str_starts_with($request->header('authorization')[0], 'bearer '));
    }

    public function test_a_key_pasted_as_one_line_works_like_the_file(): void
    {
        config(['services.apns.private_key' => str_replace("\n", '\n', (string) config('services.apns.private_key'))]);
        Http::fake(['api.push.apple.com/*' => Http::response(['reason' => 'BadDeviceToken'], 400)]);

        $this->artisan('push:status')
            ->expectsOutputToContain('Apple auth:   OK (Apple accepted the key)')
            ->assertExitCode(0);
    }

    /**
     * However the key survived the environment editor, it works: line breaks
     * flattened to spaces, escaped once or twice, wrapped in stray quotes.
     *
     * @return array<string, array{0: callable(string): string}>
     */
    public static function pastedKeys(): array
    {
        return [
            'line breaks turned to spaces' => [fn (string $pem) => str_replace("\n", ' ', $pem)],
            'one line with \\n' => [fn (string $pem) => str_replace("\n", '\\n', $pem)],
            'one line with \\\\n' => [fn (string $pem) => str_replace("\n", '\\\\n', $pem)],
            'stray quotes around it' => [fn (string $pem) => '"'.trim($pem).'"'],
            'Windows line endings' => [fn (string $pem) => str_replace("\n", "\r\n", $pem)],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('pastedKeys')]
    public function test_a_key_however_it_was_pasted_signs(callable $mangle): void
    {
        config(['services.apns.private_key' => $mangle((string) config('services.apns.private_key'))]);
        Http::fake(['api.push.apple.com/*' => Http::response(['reason' => 'BadDeviceToken'], 400)]);

        $this->artisan('push:status')
            ->expectsOutputToContain('Private key:  set')
            ->expectsOutputToContain('Apple auth:   OK (Apple accepted the key)')
            ->assertExitCode(0);
    }

    public function test_a_key_cut_short_is_reported_not_crashed_on(): void
    {
        $pem = (string) config('services.apns.private_key');
        $lines = explode("\n", trim($pem));
        config(['services.apns.private_key' => $lines[0]."\n".substr($lines[1], 0, 20)."\n".end($lines)]);
        Http::fake();

        $this->artisan('push:status')
            ->expectsOutputToContain('Private key:  set, but unusable: OpenSSL cannot read it')
            ->expectsOutputToContain('Apple auth:   not tried, the key cannot be read')
            ->assertExitCode(1);

        Http::assertNothingSent();
    }

    public function test_a_value_that_is_not_a_key_says_so(): void
    {
        config(['services.apns.private_key' => 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg']);

        $this->artisan('push:status')
            ->expectsOutputToContain('has no -----BEGIN PRIVATE KEY-----')
            ->assertExitCode(1);
    }

    public function test_it_says_why_apple_refuses_the_key(): void
    {
        Http::fake(['api.push.apple.com/*' => Http::response(['reason' => 'InvalidProviderToken'], 403)]);

        $this->artisan('push:status')
            ->expectsOutputToContain('Apple refused: InvalidProviderToken - APNS_KEY_ID, APNS_TEAM_ID and the .p8 do not belong together')
            ->assertExitCode(1);
    }

    public function test_it_says_push_is_off_when_neither_side_is_set_up(): void
    {
        config(['services.apns.private_key' => null]);

        $this->artisan('push:status')
            ->expectsOutputToContain('Apple auth:   not set up')
            ->expectsOutputToContain('Push is OFF')
            ->assertExitCode(1);
    }

    public function test_a_test_notification_reaches_an_iphone(): void
    {
        Http::fake(['api.push.apple.com/*' => Http::sequence()
            ->push(['reason' => 'BadDeviceToken'], 400)   // the probe
            ->push('', 200)]);                            // the test, to the phone
        $user = User::factory()->create([
            'email' => 'bruce@wayne.test', 'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
        ]);
        DeviceToken::create(['user_id' => $user->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);

        $this->artisan('push:status', ['--test' => 'bruce@wayne.test'])
            ->expectsOutputToContain('Test sent to')
            ->assertExitCode(0);

        // App Store and TestFlight installs register as "ios": production APNs.
        Http::assertSent(function (HttpRequest $request) {
            if ($request->url() !== 'https://api.push.apple.com/3/device/'.self::PHONE) {
                return false;
            }
            $aps = $request->data()['aps'] ?? [];

            return $request->header('apns-push-type')[0] === 'alert'
                && ($aps['alert']['body'] ?? null) === 'If you can read this in your phone\'s notifications, push works.';
        });
        $this->assertSame(1, DeviceToken::count(), 'a delivered token is kept');
    }
}
