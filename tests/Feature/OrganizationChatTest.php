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
