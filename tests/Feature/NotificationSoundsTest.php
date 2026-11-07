<?php

namespace Tests\Feature;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Settings → Notifications → Notification sound: macOS's alert sounds for the
 * Mac app, the phone's default or the portal's own tones for the iPhone.
 */
class NotificationSoundsTest extends TestCase
{
    use RefreshDatabase;

    private function member(): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
    }

    public function test_both_start_on_the_device_default(): void
    {
        $this->actingAs($this->member())->getJson('/me/notification-sounds')
            ->assertOk()
            ->assertJson(['mac' => 'default', 'iphone' => 'default'])
            ->assertJsonPath('options.mac', ['default', 'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink', 'none'])
            ->assertJsonPath('options.iphone', ['default', 'chime', 'notification', 'none']);
    }

    public function test_a_choice_is_kept_and_reaches_the_page_with_me(): void
    {
        $user = $this->member();

        $this->actingAs($user)->putJson('/me/notification-sounds', ['mac' => 'Glass', 'iphone' => 'chime'])
            ->assertOk()->assertJson(['mac' => 'Glass', 'iphone' => 'chime']);

        $this->assertSame(['mac' => 'Glass', 'iphone' => 'chime'], $user->fresh()->preferences['notificationSounds']);
        $this->actingAs($user)->getJson('/me')->assertJsonPath('desktopNotifications.sounds', ['mac' => 'Glass', 'iphone' => 'chime']);
    }

    public function test_only_the_listed_sounds_are_accepted(): void
    {
        $user = $this->member();

        // Apple's iPhone tones are not available to apps, and a file path is never a choice.
        $this->actingAs($user)->putJson('/me/notification-sounds', ['iphone' => 'Tri-tone'])->assertStatus(422);
        $this->actingAs($user)->putJson('/me/notification-sounds', ['mac' => '../../etc/passwd'])->assertStatus(422);

        $this->actingAs($user)->getJson('/me/notification-sounds')->assertJson(['mac' => 'default', 'iphone' => 'default']);
    }

    /** @return array<string, array{0: string, 1: string|null}> */
    public static function iphoneSounds(): array
    {
        return [
            'the phone\'s default tone' => ['default', 'default'],
            'the portal chime' => ['chime', 'tma-chime.caf'],
            'the portal notification tone' => ['notification', 'tma-notification.caf'],
            'silent' => ['none', null],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('iphoneSounds')]
    public function test_an_iphone_push_carries_the_chosen_sound(string $choice, ?string $expected): void
    {
        $ec = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        openssl_pkey_export($ec, $pem);
        config([
            'services.fcm.project_id' => null,
            'services.apns.key_id' => 'APNSKEY123', 'services.apns.team_id' => 'TEAM123456',
            'services.apns.bundle_id' => 'com.tmantoinelaw.portal', 'services.apns.private_key' => $pem,
        ]);
        Http::fake(['api.push.apple.com/*' => Http::response('', 200)]);

        $user = $this->member();
        $user->forceFill(['preferences' => ['notificationSounds' => ['mac' => 'default', 'iphone' => $choice]]])->save();
        DeviceToken::create(['user_id' => $user->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => str_repeat('ab', 32)]);

        Notifier::send(['user' => $user, 'type' => 'system.sync_completed', 'title' => 'Sound check', 'message' => 'Hello', 'email' => false]);

        Http::assertSent(function (HttpRequest $request) use ($expected) {
            if (! str_contains($request->url(), '/3/device/')) {
                return false;
            }
            $aps = $request->data()['aps'];

            return $expected === null ? ! array_key_exists('sound', $aps) : ($aps['sound'] ?? null) === $expected;
        });
    }
}
