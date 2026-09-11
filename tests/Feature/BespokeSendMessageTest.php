<?php

namespace Tests\Feature;

use App\Events\InboxUpdated;
use App\Events\MessageSent;
use App\Models\BespokeConversation;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Models\UserBlock;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Send button under a Bespoke draft. The model proposed; the reader's
 * click is what sends, and reach is checked again on that click.
 */
class BespokeSendMessageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.bespoke.enabled' => true]);
        // Only the broadcasts: faking every event would also silence the
        // model hooks that assign uuids.
        Event::fake([MessageSent::class, InboxUpdated::class]);
    }

    private function user(string $accountType, array $extra = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $extra));
    }

    public function test_send_creates_the_direct_thread_stores_the_message_and_notes_it_in_the_chat(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Olivia Officer']);
        $vernon = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis', 'job_title' => 'IT & Web Solutions Specialist']);
        $thread = BespokeConversation::create(['uuid' => (string) Str::uuid(), 'user_id' => $officer->id, 'title' => 'IT help']);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/actions/send-message', [
                'userId' => $vernon->id,
                'body' => "Hi Vernon,\n\nI cannot open the File Library.",
                'conversationId' => $thread->uuid,
            ])
            ->assertOk()
            ->json();

        $this->assertTrue($payload['ok']);
        $this->assertSame('Vernon Francis', $payload['recipient']['name']);

        $conversation = Conversation::query()->where('type', 'direct')->firstOrFail();
        $this->assertStringContainsString('/social/messages?conversation='.$conversation->uuid, $payload['url']);
        $this->assertSame([$officer->id, $vernon->id], $conversation->participants()->pluck('user_id')->sort()->values()->all());

        $message = Message::query()->where('conversation_id', $conversation->id)->firstOrFail();
        $this->assertSame($officer->id, $message->user_id);
        $this->assertSame(Message::TYPE_TEXT, $message->type);
        $this->assertStringContainsString('cannot open the File Library', $message->body);
        $this->assertNotNull($conversation->fresh()->last_message_at);

        // The reader's own copy is already read; the Bespoke thread records what happened.
        $me = $conversation->participants()->where('user_id', $officer->id)->firstOrFail();
        $this->assertSame($message->id, $me->last_read_message_id);
        $note = $thread->messages()->latest('id')->firstOrFail();
        $this->assertSame('assistant', $note->role);
        $this->assertStringContainsString('Sent to Vernon Francis', $note->body);

        // A second send reuses the thread rather than opening another.
        $this->actingAs($officer)->postJson('/portal/bespoke/actions/send-message', [
            'userId' => $vernon->id, 'body' => 'Also, thanks.',
        ])->assertOk();
        $this->assertSame(1, Conversation::query()->where('type', 'direct')->count());
        $this->assertSame(2, Message::query()->where('conversation_id', $conversation->id)->count());
        Event::assertDispatched(MessageSent::class, 2);
        Event::assertDispatched(InboxUpdated::class, 1);
    }

    public function test_a_client_cannot_send_to_staff_outside_their_team(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, ['name' => 'Ada Admin']);
        $mine = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Olivia Officer']);
        $other = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Oscar Other']);
        $client = $this->user(Role::CLIENT, ['name' => 'Cara Client']);
        $record = Client::create(['uid' => 'cara', 'name' => 'Cara Client', 'user_id' => $client->id, 'email' => $client->email, 'data' => []]);
        ClientAssignment::create(['client_id' => $record->id, 'user_id' => $mine->id, 'role' => 'lead', 'status' => ClientAssignment::STATUS_ACTIVE, 'assigned_by' => $admin->id]);

        $this->actingAs($client)->postJson('/portal/bespoke/actions/send-message', [
            'userId' => $other->id, 'body' => 'hello',
        ])->assertStatus(422);
        $this->assertSame(0, Message::query()->count());

        $this->actingAs($client)->postJson('/portal/bespoke/actions/send-message', [
            'userId' => $mine->id, 'body' => 'hello',
        ])->assertOk();
        $this->actingAs($client)->postJson('/portal/bespoke/actions/send-message', [
            'userId' => $admin->id, 'body' => 'hello admin',
        ])->assertOk();
        $this->assertSame(2, Message::query()->count());
    }

    public function test_self_blocked_and_unapproved_recipients_are_refused(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $blocked = $this->user(Role::ADMINISTRATOR);
        $pending = $this->user(Role::ADMINISTRATOR, ['status' => 'pending']);
        UserBlock::create(['user_id' => $blocked->id, 'blocked_user_id' => $officer->id]);

        foreach ([$officer->id, $blocked->id, $pending->id, 999999] as $id) {
            $this->actingAs($officer)->postJson('/portal/bespoke/actions/send-message', [
                'userId' => $id, 'body' => 'hello',
            ])->assertStatus(422);
        }
        $this->assertSame(0, Message::query()->count());
    }

    public function test_the_endpoint_is_dark_with_the_flag_off(): void
    {
        config(['services.bespoke.enabled' => false]);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($officer)->postJson('/portal/bespoke/actions/send-message', [
            'userId' => $admin->id, 'body' => 'hello',
        ])->assertNotFound();
    }
}
