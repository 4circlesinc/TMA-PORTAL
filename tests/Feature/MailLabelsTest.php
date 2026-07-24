<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailLabel;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Label management end to end: creating, renaming, recolouring and deleting
 * labels, with the provider faked at the HTTP boundary — plus the local-only
 * fallback for when the provider cannot hold the label.
 */
class MailLabelsTest extends TestCase
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

    private function account(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);
    }

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-'.Str::random(6),
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    private function label(User $user, ConnectedAccount $account, array $overrides = []): MailLabel
    {
        return MailLabel::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'Label_1',
            'name' => 'Clients',
            'tone' => 'blue',
            'is_system' => false,
        ], $overrides));
    }

    private function fakeToken(array $extra = []): void
    {
        Http::fake(array_merge([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
        ], $extra));
    }

    public function test_creating_a_label_writes_it_to_the_provider_and_the_portal(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->fakeToken([
            'gmail.googleapis.com/gmail/v1/users/me/labels' => Http::response(['id' => 'Label_77', 'name' => 'Invoices']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/labels', ['name' => 'Invoices', 'tone' => 'green'])
            ->assertCreated()
            ->assertJsonPath('label.name', 'Invoices')
            ->assertJsonPath('label.tone', 'green')
            ->assertJsonPath('label.count', 0);

        $this->assertDatabaseHas('mail_labels', [
            'user_id' => $user->id,
            'name' => 'Invoices',
            'tone' => 'green',
            'remote_id' => 'Label_77',
        ]);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/labels')
                && $request->method() === 'POST'
                && ($request->data()['name'] ?? null) === 'Invoices';
        });
    }

    public function test_a_label_the_provider_refuses_still_exists_as_a_portal_only_label(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->fakeToken([
            'gmail.googleapis.com/*' => Http::response(['error' => 'nope'], 500),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/labels', ['name' => 'Personal', 'tone' => 'red'])
            ->assertCreated();

        $label = MailLabel::where('name', 'Personal')->firstOrFail();

        $this->assertTrue($label->isLocalOnly());
    }

    public function test_a_duplicate_label_name_is_rejected(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->label($user, $account, ['name' => 'Clients']);

        $this->fakeToken();

        $this->actingAs($user)
            ->postJson('/portal/mail/labels', ['name' => 'clients', 'tone' => 'blue'])
            ->assertStatus(422);
    }

    public function test_renaming_and_recolouring_a_label_updates_the_provider_and_the_portal(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $label = $this->label($user, $account, ['name' => 'Clients', 'tone' => 'blue']);

        $this->fakeToken([
            'gmail.googleapis.com/*' => Http::response(['id' => 'Label_1', 'name' => 'Customers']),
        ]);

        $this->actingAs($user)
            ->patchJson('/portal/mail/labels/'.$label->uuid, ['name' => 'Customers', 'tone' => 'purple'])
            ->assertOk()
            ->assertJsonPath('label.name', 'Customers')
            ->assertJsonPath('label.tone', 'purple');

        $this->assertDatabaseHas('mail_labels', ['id' => $label->id, 'name' => 'Customers', 'tone' => 'purple']);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/labels/Label_1')
                && $request->method() === 'PATCH';
        });
    }

    public function test_recolouring_alone_never_calls_the_provider(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $label = $this->label($user, $account);

        Http::fake(); // Any request at all would fail the assertion below.

        $this->actingAs($user)
            ->patchJson('/portal/mail/labels/'.$label->uuid, ['tone' => 'orange'])
            ->assertOk()
            ->assertJsonPath('label.tone', 'orange');

        Http::assertNothingSent();
    }

    public function test_deleting_a_label_detaches_its_messages_and_removes_it_everywhere(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $label = $this->label($user, $account);
        $message = $this->message($user, $account);
        $message->labels()->attach($label->id);

        $this->fakeToken([
            'gmail.googleapis.com/*' => Http::response([]),
        ]);

        $this->actingAs($user)
            ->deleteJson('/portal/mail/labels/'.$label->uuid)
            ->assertOk()
            ->assertJsonPath('deleted', true);

        $this->assertDatabaseMissing('mail_labels', ['id' => $label->id]);
        $this->assertDatabaseMissing('mail_label_message', ['mail_label_id' => $label->id]);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/labels/Label_1')
                && $request->method() === 'DELETE';
        });
    }

    public function test_applying_a_portal_only_label_never_calls_the_provider(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $label = $this->label($user, $account, [
            'remote_id' => MailLabel::LOCAL_PREFIX.Str::uuid(),
            'name' => 'Local only',
        ]);
        $message = $this->message($user, $account);

        Http::fake();

        $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$message->uuid.'/labels', [
                'label' => $label->uuid,
                'applied' => true,
            ])
            ->assertOk();

        $this->assertDatabaseHas('mail_label_message', [
            'mail_message_id' => $message->id,
            'mail_label_id' => $label->id,
        ]);

        Http::assertNothingSent();
    }

    public function test_the_incremental_sync_keeps_portal_only_labels_on_a_message(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $providerLabel = $this->label($user, $account, ['remote_id' => 'Label_1', 'name' => 'Synced']);
        $localLabel = $this->label($user, $account, [
            'remote_id' => MailLabel::LOCAL_PREFIX.Str::uuid(),
            'name' => 'Local only',
        ]);

        $message = $this->message($user, $account);
        $message->labels()->attach([$providerLabel->id, $localLabel->id]);

        // Replay what the provider reports for this message: only its own
        // label. The portal-only one must survive the sync() diff.
        $sync = new MailSynchronizer($account);
        $method = new \ReflectionMethod($sync, 'syncMessageLabels');
        $method->invoke($sync, $message, ['Label_1']);

        $remaining = $message->fresh()->labels()->pluck('mail_labels.id')->all();
        sort($remaining);

        $expected = [$providerLabel->id, $localLabel->id];
        sort($expected);

        $this->assertSame($expected, $remaining);
    }

    public function test_the_bootstrap_reports_each_labels_message_count(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $label = $this->label($user, $account);
        $message = $this->message($user, $account);
        $message->labels()->attach($label->id);

        $this->fakeToken(['gmail.googleapis.com/*' => Http::response(['labels' => []])]);

        $this->actingAs($user)
            ->getJson('/portal/mail')
            ->assertOk()
            ->assertJsonPath('labels.0.name', 'Clients')
            ->assertJsonPath('labels.0.count', 1);
    }
}
