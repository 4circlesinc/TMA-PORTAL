<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class MailPaginationTest extends TestCase
{
    use RefreshDatabase;

    private function mailUser(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function account(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'p1',
            'email' => $user->email,
            'name' => $user->name,
            'token' => 'token',
            'scopes' => ['Mail.Read'],
            'sync_email' => true,
        ]);
    }

    private function seedMessages(User $user, ConnectedAccount $account, int $count, ?string $from = null): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'uuid' => (string) Str::uuid(),
                'user_id' => $user->id,
                'connected_account_id' => $account->id,
                'remote_id' => 'm'.$i,
                'folder' => 'inbox',
                'subject' => 'Message '.$i,
                'from_email' => $from ?? ('sender'.$i.'@example.com'),
                'from_name' => 'Sender '.$i,
                'is_read' => false,
                'is_starred' => false,
                'is_important' => false,
                'has_attachments' => false,
                'sent_at' => now()->subMinutes($i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        MailMessage::insert($rows);
    }

    public function test_listing_is_paged_and_reports_page_metadata(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $this->seedMessages($user, $account, 120);

        $res = $this->actingAs($user)->getJson('/portal/mail/messages?folder=inbox&perPage=25&page=2')
            ->assertOk()
            ->assertJsonPath('total', 120)
            ->assertJsonPath('page', 2)
            ->assertJsonPath('perPage', 25)
            ->assertJsonPath('lastPage', 5)
            ->assertJsonPath('hasMore', true);

        $this->assertCount(25, $res->json('messages'));
        $this->assertSame([25, 50, 100, 200], $res->json('perPageOptions'));
    }

    public function test_a_large_page_size_returns_far_more_than_the_old_fixed_limit(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $this->seedMessages($user, $account, 250);

        $res = $this->actingAs($user)->getJson('/portal/mail/messages?folder=inbox&perPage=200')
            ->assertOk()
            ->assertJsonPath('total', 250)
            ->assertJsonPath('lastPage', 2);

        $this->assertCount(200, $res->json('messages'));
    }

    public function test_an_unsupported_page_size_is_rejected(): void
    {
        $user = $this->mailUser();
        $this->account($user);

        $this->actingAs($user)->getJson('/portal/mail/messages?folder=inbox&perPage=7')
            ->assertStatus(422);
    }

    public function test_senders_with_a_portal_photo_get_an_avatar_and_others_do_not(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);

        $sender = User::factory()->create([
            'email' => 'photo@example.com',
            'avatar_url' => '/storage/avatars/photo.png',
        ]);

        $this->seedMessages($user, $account, 1, $sender->email);
        // A sender with no portal account at all.
        MailMessage::insert([[
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'stranger',
            'folder' => 'inbox',
            'subject' => 'Hello',
            'from_email' => 'nobody@elsewhere.test',
            'from_name' => 'Nobody',
            'is_read' => false, 'is_starred' => false, 'is_important' => false, 'has_attachments' => false,
            'sent_at' => now()->subHour(),
            'created_at' => now(), 'updated_at' => now(),
        ]]);

        $rows = collect($this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=inbox')
            ->assertOk()
            ->json('messages'))
            ->keyBy('email');

        $this->assertSame('/storage/avatars/photo.png', $rows['photo@example.com']['avatarUrl']);
        $this->assertNull($rows['nobody@elsewhere.test']['avatarUrl']);
    }

    public function test_sync_status_reports_backfill_progress(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $this->seedMessages($user, $account, 30);

        $account->forceFill(['mail_backfill' => [
            '_totals' => ['inbox' => 120, 'sent' => 5],
            'inbox' => ['token' => 'next', 'done' => false],
        ]])->save();

        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('connected', true)
            ->assertJsonPath('running', true)
            ->assertJsonPath('done', false)
            ->assertJsonPath('synced', 30)
            ->assertJsonPath('total', 125);
    }

    public function test_sync_status_reports_done_once_backfilled(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $account->forceFill(['mail_backfilled_at' => now()])->save();

        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('running', false)
            ->assertJsonPath('done', true);
    }

    public function test_sync_status_is_quiet_without_a_mailbox(): void
    {
        $user = $this->mailUser();

        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('connected', false)
            ->assertJsonPath('running', false);
    }
}
