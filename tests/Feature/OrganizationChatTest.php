<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Messaging\OrganizationChat;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The firm chat is internal. Clients and service-provider contacts must not
 * land in it just because they opened Messages.
 *
 * It is also simply there: nobody runs a command to create it, and nobody has
 * to open Messages to be in it.
 */
class OrganizationChatTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType, string $email): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function inChat(User $user, Conversation $chat): bool
    {
        return ConversationParticipant::query()
            ->where('conversation_id', $chat->id)
            ->where('user_id', $user->id)
            ->whereNull('left_at')
            ->exists();
    }

    public function test_the_firm_chat_creates_itself_the_first_time_messages_is_opened(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');

        $this->assertNull(OrganizationChat::current());

        $listed = collect($this->actingAs($admin)->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->json('conversations'));

        $chat = OrganizationChat::current();

        $this->assertNotNull($chat);
        $this->assertTrue($chat->auto_join);
        $this->assertSame(OrganizationChat::NAME, $chat->name);

        $row = $listed->firstWhere('id', $chat->uuid);

        $this->assertNotNull($row, 'The firm chat is in the list on the very first load.');
        $this->assertTrue($row['isDefault']);
        $this->assertTrue($row['pinned']);

        // Asking again, by the Messages page or the Dashboard, makes no second one.
        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();
        OrganizationChat::syncMembership();

        $this->assertSame(1, Conversation::where('is_default', true)->count());
    }

    public function test_every_member_of_staff_is_in_it_before_they_have_opened_messages(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $second = $this->user(Role::ADMINISTRATOR, 'bea@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        $legacy = $this->user(Role::COMPLIANCE_OFFICER, 'cole@example.com');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example');
        $providerAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'pam@galaxy.example');

        // Only one of them ever opens Messages.
        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();

        $chat = OrganizationChat::current();

        foreach ([$admin, $second, $officer, $legacy] as $colleague) {
            $this->assertTrue($this->inChat($colleague, $chat), $colleague->email.' should be in the firm chat.');
        }

        $this->assertFalse($this->inChat($contact, $chat));
        $this->assertFalse($this->inChat($providerAdmin, $chat));

        // Administrators can manage it; it is pinned for everyone.
        $roles = ConversationParticipant::where('conversation_id', $chat->id)->pluck('role', 'user_id');

        $this->assertSame(ConversationParticipant::ROLE_ADMIN, $roles[$second->id]);
        $this->assertSame(ConversationParticipant::ROLE_MEMBER, $roles[$officer->id]);
        $this->assertSame(
            0,
            ConversationParticipant::where('conversation_id', $chat->id)->whereNull('pinned_at')->count()
        );

        // And the colleague who never looked finds it waiting, with the count right.
        $row = collect($this->actingAs($officer)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->firstWhere('id', $chat->uuid);

        $this->assertNotNull($row);
        $this->assertSame(4, $row['memberCount']);
    }

    public function test_someone_approved_later_joins_without_opening_messages(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');

        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();
        $chat = OrganizationChat::current();

        $newcomer = $this->user(Role::REVIEWING_OFFICER, 'nia@example.com');

        $this->assertFalse($this->inChat($newcomer, $chat));

        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();

        $this->assertTrue($this->inChat($newcomer, $chat));
    }

    public function test_accounts_that_cannot_open_the_portal_are_not_in_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $pending = $this->user(Role::REVIEWING_OFFICER, 'pat@example.com');
        $pending->forceFill(['status' => User::STATUS_PENDING])->save();
        // Held on the role-pending screen until an administrator types them.
        $parked = $this->user(Role::EMPLOYEE, 'eve@example.com');
        $leaving = $this->user(Role::REVIEWING_OFFICER, 'sam@example.com');

        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();
        $chat = OrganizationChat::current();

        $this->assertFalse($this->inChat($pending, $chat));
        $this->assertFalse($this->inChat($parked, $chat));
        $this->assertTrue($this->inChat($leaving, $chat));

        // Suspended: out. Reinstated: back, on the row they had.
        $before = ConversationParticipant::where('conversation_id', $chat->id)
            ->where('user_id', $leaving->id)
            ->value('id');

        $leaving->forceFill(['status' => User::STATUS_SUSPENDED])->save();
        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();
        $this->assertFalse($this->inChat($leaving, $chat));

        $leaving->forceFill(['status' => User::STATUS_APPROVED])->save();
        $parked->forceFill(['account_type' => Role::REVIEWING_OFFICER])->save();
        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();

        $this->assertTrue($this->inChat($leaving, $chat));
        $this->assertTrue($this->inChat($parked, $chat));
        $this->assertSame(
            $before,
            ConversationParticipant::where('conversation_id', $chat->id)->where('user_id', $leaving->id)->value('id')
        );
    }

    public function test_nobody_is_removed_from_the_firm_chat_by_hand(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');

        $row = collect($this->actingAs($admin)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->firstWhere('isDefault', true);

        $this->assertTrue($row['autoJoin']);

        $this->actingAs($admin)
            ->deleteJson('/portal/messaging/groups/'.$row['id'].'/members/'.$officer->id)
            ->assertStatus(422);

        $this->assertTrue($this->inChat($officer, OrganizationChat::current()));
    }

    public function test_the_dashboard_puts_staff_in_the_firm_chat_too(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');

        $this->actingAs($officer)->getJson('/portal/dashboard/home')->assertOk();

        $chat = OrganizationChat::current();

        $this->assertNotNull($chat);
        $this->assertTrue($this->inChat($admin, $chat));
        $this->assertTrue($this->inChat($officer, $chat));
    }

    public function test_staff_join_the_firm_chat_and_clients_do_not(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example');

        $chat = OrganizationChat::ensure($admin);

        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();
        $this->actingAs($officer)->getJson('/portal/messaging/conversations')->assertOk();
        $this->actingAs($contact)->getJson('/portal/messaging/conversations')->assertOk();

        $this->assertTrue($this->inChat($admin, $chat));
        $this->assertTrue($this->inChat($officer, $chat));
        $this->assertFalse($this->inChat($contact, $chat));

        $ids = collect($this->actingAs($contact)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->pluck('id');
        $this->assertFalse($ids->contains($chat->uuid));
    }

    public function test_a_client_already_in_the_firm_chat_is_removed(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example');
        $chat = OrganizationChat::ensure($admin);

        ConversationParticipant::create([
            'conversation_id' => $chat->id,
            'user_id' => $contact->id,
            'role' => ConversationParticipant::ROLE_MEMBER,
            'joined_at' => now(),
        ]);

        $this->assertTrue($this->inChat($contact, $chat));

        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();

        $this->assertFalse($this->inChat($contact->fresh(), $chat));
    }

    public function test_an_administrator_cannot_add_a_client_to_the_firm_chat(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example');
        $chat = OrganizationChat::ensure($admin);

        $this->actingAs($admin)->getJson('/portal/messaging/conversations')->assertOk();

        $this->actingAs($admin)
            ->postJson('/portal/messaging/groups/'.$chat->uuid.'/members', [
                'memberIds' => [$contact->id],
            ])
            ->assertStatus(422);

        $this->assertFalse($this->inChat($contact, $chat));
    }
}
