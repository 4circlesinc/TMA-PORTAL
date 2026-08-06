<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\User;
use App\Models\UserPresence;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The email channel of Settings → Notifications: a fresh notification emails
 * its recipient when their module's Email switch is on — skipped while they
 * are actively online (unless "always send email" is set), and never for a
 * module whose email channel is off.
 */
class NotificationEmailTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
        ], $overrides));
    }

    private function notify(User $recipient, array $overrides = []): void
    {
        Notifier::send(array_merge([
            'user' => $recipient,
            'actor' => $this->user(),
            // security group: email channel defaults ON.
            'type' => 'security.password_changed',
            'title' => 'Something happened',
            'message' => 'Details inside.',
            'action_url' => '/account-settings',
        ], $overrides));
    }

    public function test_a_module_with_email_on_queues_a_postcard(): void
    {
        Mail::fake();
        $recipient = $this->user();

        $this->notify($recipient);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($recipient) {
            return $mail->hasTo($recipient->email)
                && $mail->subjectLine === 'Something happened';
        });
    }

    public function test_a_module_with_email_off_sends_nothing(): void
    {
        Mail::fake();
        $recipient = $this->user();

        // files group: email channel defaults OFF.
        $this->notify($recipient, ['type' => 'file.shared']);

        Mail::assertNotQueued(Postcard::class);
    }

    public function test_an_actively_online_user_is_not_emailed(): void
    {
        Mail::fake();
        $recipient = $this->user();
        UserPresence::create([
            'user_id' => $recipient->id,
            'last_seen_at' => now(),
            'online_until' => now()->addMinutes(2),
        ]);

        $this->notify($recipient);

        Mail::assertNotQueued(Postcard::class);
    }

    public function test_always_send_email_overrides_presence(): void
    {
        Mail::fake();
        $recipient = $this->user(['preferences' => ['notifyAlwaysEmail' => true]]);
        UserPresence::create([
            'user_id' => $recipient->id,
            'last_seen_at' => now(),
            'online_until' => now()->addMinutes(2),
        ]);

        $this->notify($recipient);

        Mail::assertQueued(Postcard::class);
    }

    public function test_a_dedupe_refresh_does_not_email_twice(): void
    {
        Mail::fake();
        $recipient = $this->user();

        $this->notify($recipient, ['dedupe_key' => 'once']);
        $this->notify($recipient, ['dedupe_key' => 'once']);

        Mail::assertQueued(Postcard::class, 1);
    }

    public function test_switching_the_channel_on_makes_a_quiet_module_email(): void
    {
        Mail::fake();
        $recipient = $this->user([
            'preferences' => ['notifications' => ['files' => ['email' => true]]],
        ]);

        $this->notify($recipient, ['type' => 'file.shared']);

        Mail::assertQueued(Postcard::class);
    }
}
