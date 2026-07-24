<?php

namespace Tests\Feature;

use App\Models\MailSenderPhoto;
use App\Models\Notification;
use App\Models\User;
use App\Support\Notifications\NotificationPresenter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Email notifications must show the same sender image the inbox list would:
 * portal user photo → MailSenderPhoto::urlFor (directory / Gravatar / brand).
 */
class NotificationEmailAvatarConsistencyTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function notification(User $user, string $fromEmail, string $fromName): Notification
    {
        return Notification::create([
            'uid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'type' => 'email.received',
            'module' => 'email',
            'level' => Notification::LEVEL_INFO,
            'priority' => 'normal',
            'title' => 'New email from '.$fromName,
            'message' => 'Subject line',
            'icon' => 'EnvelopeSimple',
            'action_url' => '/email',
            'action_label' => 'Open email',
            'metadata' => [
                'from_email' => mb_strtolower($fromEmail),
                'from_name' => $fromName,
            ],
        ]);
    }

    public function test_email_notification_uses_same_sender_photo_url_as_inbox(): void
    {
        $user = $this->user();
        $email = 'brand.sender@example.com';
        $hash = MailSenderPhoto::hashFor($email);

        MailSenderPhoto::create([
            'hash' => $hash,
            'email' => $email,
            'disk' => 'public',
            'path' => 'mail-sender-photos/'.$hash.'.png',
            'mime' => 'image/png',
            'has_photo' => true,
            'source' => 'brand',
            'checked_at' => now(),
        ]);

        $expected = '/portal/mail/sender-photo/'.$hash;
        $this->assertSame($expected, MailSenderPhoto::urlFor($email));

        $payload = NotificationPresenter::notification(
            $this->notification($user, $email, 'Brand Sender')
        );

        $this->assertSame($expected, $payload['image']);
    }

    public function test_email_notification_prefers_portal_user_photo(): void
    {
        $user = $this->user();
        $sender = User::factory()->create([
            'email' => 'colleague@example.com',
            'avatar_url' => '/media/avatars/colleague.jpg',
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $payload = NotificationPresenter::notification(
            $this->notification($user, $sender->email, $sender->name)
        );

        $this->assertSame('/media/avatars/colleague.jpg', $payload['image']);
    }

    public function test_notifications_api_returns_sender_image_for_email_rows(): void
    {
        $user = $this->user();
        $email = 'face@example.com';
        $hash = MailSenderPhoto::hashFor($email);

        MailSenderPhoto::create([
            'hash' => $hash,
            'email' => $email,
            'disk' => 'public',
            'path' => 'mail-sender-photos/'.$hash.'.jpg',
            'mime' => 'image/jpeg',
            'has_photo' => true,
            'source' => 'directory',
            'checked_at' => now(),
        ]);

        $this->notification($user, $email, 'Face Person');

        $response = $this->actingAs($user)->getJson('/portal/notifications');

        $response->assertOk();
        $item = collect($response->json('items'))->firstWhere('meta.from_email', $email);
        $this->assertNotNull($item);
        $this->assertSame('/portal/mail/sender-photo/'.$hash, $item['image']);
    }
}
