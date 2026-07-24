<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ConnectedAccount;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\MailMessage;
use App\Models\MailSenderPhoto;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase-1 compose recipient typeahead: portal users, clients, groups, and
 * addresses mined from the viewer's mirrored mailbox — no provider OAuth.
 */
class MailRecipientSuggestTest extends TestCase
{
    use RefreshDatabase;

    private function staff(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    public function test_suggests_organization_staff_by_name_or_email(): void
    {
        $me = $this->staff(['name' => 'Me', 'email' => 'me@example.com']);
        $this->staff([
            'name' => 'Dana Reed',
            'email' => 'dana@example.com',
            'avatar_url' => '/images/avatars/Avatar3d01.png',
        ]);
        $this->staff(['name' => 'Pat Lee', 'email' => 'pat@example.com']);

        $items = $this->actingAs($me)
            ->getJson('/portal/mail/suggest?q=dana')
            ->assertOk()
            ->json('suggestions');

        $this->assertNotEmpty($items);
        $this->assertSame('dana@example.com', $items[0]['email']);
        $this->assertSame('staff', $items[0]['source']);
        $this->assertSame('Organization', $items[0]['sourceLabel']);
        // Portal uploads are intentionally NOT used — Microsoft/Google only.
        $this->assertNull($items[0]['avatarUrl']);
    }

    public function test_suggests_clients_for_staff_and_hides_them_from_client_accounts(): void
    {
        $staff = $this->staff();
        Client::create([
            'uid' => 'acme',
            'name' => 'Acme Corp',
            'company' => 'Acme',
            'email' => 'hello@acme.test',
            'data' => [],
            'created_by' => $staff->id,
        ]);

        $staffHits = $this->actingAs($staff)
            ->getJson('/portal/mail/suggest?q=acme')
            ->assertOk()
            ->json('suggestions');

        $this->assertTrue(collect($staffHits)->contains(fn ($s) => ($s['email'] ?? null) === 'hello@acme.test' && $s['source'] === 'client'));

        $clientUser = $this->staff([
            'account_type' => 'Client',
            'email' => 'client-user@example.com',
        ]);

        $clientHits = $this->actingAs($clientUser)
            ->getJson('/portal/mail/suggest?q=acme')
            ->assertOk()
            ->json('suggestions');

        $this->assertFalse(collect($clientHits)->contains(fn ($s) => ($s['source'] ?? null) === 'client'));
    }

    public function test_suggests_a_group_as_an_expandable_member_list(): void
    {
        $me = $this->staff(['email' => 'me@example.com']);
        $a = $this->staff(['name' => 'Alex', 'email' => 'alex@example.com']);
        $b = $this->staff(['name' => 'Blake', 'email' => 'blake@example.com']);

        $group = Group::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Marketing Team',
            'group_type' => Group::TYPE_TEAM,
            'created_by' => $me->id,
        ]);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $a->id, 'role' => 'member']);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $b->id, 'role' => 'member']);

        $items = $this->actingAs($me)
            ->getJson('/portal/mail/suggest?q=marketing')
            ->assertOk()
            ->json('suggestions');

        $groupHit = collect($items)->firstWhere('source', 'group');
        $this->assertNotNull($groupHit);
        $this->assertSame('Marketing Team', $groupHit['name']);
        $this->assertCount(2, $groupHit['emails']);
        $this->assertEqualsCanonicalizing(
            ['alex@example.com', 'blake@example.com'],
            array_column($groupHit['emails'], 'email')
        );
    }

    public function test_suggests_addresses_from_prior_mail_and_merges_duplicates_preferring_staff(): void
    {
        $me = $this->staff(['email' => 'me@example.com']);
        $dana = $this->staff(['name' => 'Dana Reed', 'email' => 'dana@example.com']);

        $account = ConnectedAccount::create([
            'user_id' => $me->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$me->id,
            'email' => 'me@example.com',
            'name' => 'Me',
            'token' => 'refresh',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $me->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'm1',
            'thread_id' => 't1',
            'folder' => 'inbox',
            'subject' => 'Hello',
            'from_name' => 'Dana Old Name',
            'from_email' => 'dana@example.com',
            'to' => [['name' => 'Me', 'email' => 'me@example.com']],
            'is_read' => true,
            'sent_at' => now()->subHour(),
        ]);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $me->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'm2',
            'thread_id' => 't2',
            'folder' => 'inbox',
            'subject' => 'Partner',
            'from_name' => 'Pat Partner',
            'from_email' => 'pat.partner@example.com',
            'to' => [['email' => 'me@example.com']],
            'is_read' => true,
            'sent_at' => now()->subMinutes(30),
        ]);

        $items = $this->actingAs($me)
            ->getJson('/portal/mail/suggest?q=dana')
            ->assertOk()
            ->json('suggestions');

        $danaHit = collect($items)->firstWhere('email', 'dana@example.com');
        $this->assertNotNull($danaHit);
        // Staff wins over the older from_name on the message.
        $this->assertSame('staff', $danaHit['source']);
        $this->assertSame('Dana Reed', $danaHit['name']);
        $this->assertSame($dana->name, $danaHit['name']);

        $prior = $this->actingAs($me)
            ->getJson('/portal/mail/suggest?q=partner')
            ->assertOk()
            ->json('suggestions');

        $this->assertTrue(collect($prior)->contains(fn ($s) => ($s['email'] ?? null) === 'pat.partner@example.com' && $s['source'] === 'prior'));
    }

    public function test_prior_mail_suggestions_include_cached_sender_photos(): void
    {
        $me = $this->staff(['email' => 'me@example.com']);
        $account = ConnectedAccount::create([
            'user_id' => $me->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$me->id,
            'email' => 'me@example.com',
            'name' => 'Me',
            'token' => 'refresh',
            'scopes' => ['Mail.ReadWrite'],
            'sync_email' => true,
        ]);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $me->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'm-photo',
            'thread_id' => 't-photo',
            'folder' => 'inbox',
            'subject' => 'Hi',
            'from_name' => 'Pat Partner',
            'from_email' => 'pat.partner@example.com',
            'to' => [['email' => 'me@example.com']],
            'is_read' => true,
            'sent_at' => now()->subHour(),
        ]);

        $hash = MailSenderPhoto::hashFor('pat.partner@example.com');
        MailSenderPhoto::create([
            'hash' => $hash,
            'email' => 'pat.partner@example.com',
            'connected_account_id' => $account->id,
            'disk' => 'local',
            'path' => 'sender-photos/pat.jpg',
            'mime' => 'image/jpeg',
            'has_photo' => true,
            'checked_at' => now(),
        ]);

        $items = $this->actingAs($me)
            ->getJson('/portal/mail/suggest?q=partner')
            ->assertOk()
            ->json('suggestions');

        $hit = collect($items)->firstWhere('email', 'pat.partner@example.com');
        $this->assertNotNull($hit);
        $this->assertNotNull($hit['avatarUrl']);
        $this->assertStringContainsString('/portal/mail/sender-photo/'.$hash, $hit['avatarUrl']);
    }

    public function test_empty_query_returns_recent_prior_and_staff_without_error(): void
    {
        $me = $this->staff(['email' => 'me@example.com']);
        $this->staff(['name' => 'Dana Reed', 'email' => 'dana@example.com']);

        $this->actingAs($me)
            ->getJson('/portal/mail/suggest')
            ->assertOk()
            ->assertJsonStructure(['suggestions']);
    }
}
