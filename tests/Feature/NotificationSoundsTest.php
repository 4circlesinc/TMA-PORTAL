<?php

namespace Tests\Feature;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Settings → Notifications → Notification sound, in the iPhone app: the TM
 * tone (the portal's chime) by default, or the Apple tone, the phone's
 * Default Alerts sound. iOS gives apps no Text Tone, so that is the Apple
 * sound an app can follow.
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

    public function test_the_tm_tone_is_the_default(): void
    {
        $user = $this->member();

        $this->actingAs($user)->getJson('/me/notification-sounds')
            ->assertOk()
            ->assertJson(['iphone' => 'chime'])
            ->assertJsonPath('options.iphone', ['chime', 'default']);
        $this->actingAs($user)->getJson('/me')->assertJsonPath('desktopNotifications.sounds', ['iphone' => 'chime']);
    }

    public function test_the_apple_tone_is_kept_and_reaches_the_page_with_me(): void
    {
        $user = $this->member();

        $this->actingAs($user)->putJson('/me/notification-sounds', ['iphone' => 'default'])
            ->assertOk()->assertJson(['iphone' => 'default']);

        $this->assertSame(['iphone' => 'default'], $user->fresh()->preferences['notificationSounds']);
        $this->actingAs($user)->getJson('/me')->assertJsonPath('desktopNotifications.sounds', ['iphone' => 'default']);
    }

    public function test_only_the_two_tones_are_accepted(): void
    {
        $user = $this->member();

        // Apple's own tones (Tri-tone, the Text Tone) are not available to apps,
        // and a file name is never a choice.
        $this->actingAs($user)->putJson('/me/notification-sounds', ['iphone' => 'Tri-tone'])->assertStatus(422);
        $this->actingAs($user)->putJson('/me/notification-sounds', ['iphone' => '../../etc/passwd'])->assertStatus(422);
        $this->actingAs($user)->putJson('/me/notification-sounds', [])->assertStatus(422);

        $this->actingAs($user)->getJson('/me/notification-sounds')->assertJson(['iphone' => 'chime']);
    }

    public function test_a_choice_saved_by_the_earlier_sound_setting_falls_back_to_the_tm_tone(): void
    {
        $user = $this->member();
        $user->forceFill(['preferences' => ['notificationSounds' => ['mac' => 'Glass', 'iphone' => 'notification']]])->save();

        $this->actingAs($user)->getJson('/me/notification-sounds')->assertJson(['iphone' => 'chime']);
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function iphoneSounds(): array
    {
        return [
            'nothing chosen: the TM tone' => [[], 'tma-chime.caf'],
            'the TM tone' => [['notificationSounds' => ['iphone' => 'chime']], 'tma-chime.caf'],
            'the Apple tone (Default Alerts)' => [['notificationSounds' => ['iphone' => 'default']], 'default'],
        ];
    }

    /** @param array<string, mixed> $preferences */
    #[DataProvider('iphoneSounds')]
    public function test_an_iphone_push_carries_the_chosen_sound(array $preferences, string $expected): void
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
        $user->forceFill(['preferences' => $preferences])->save();
        DeviceToken::create(['user_id' => $user->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => str_repeat('ab', 32)]);

        Notifier::send(['user' => $user, 'type' => 'system.sync_completed', 'title' => 'Sound check', 'message' => 'Hello', 'email' => false]);

        Http::assertSent(function (HttpRequest $request) use ($expected) {
            if (! str_contains($request->url(), '/3/device/')) {
                return false;
            }
            $body = $request->data();

            return ($body['aps']['sound'] ?? null) === $expected && ! array_key_exists('iosSound', $body);
        });
    }
}
