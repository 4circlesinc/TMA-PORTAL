<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Message;
use App\Models\User;
use App\Support\Cip\Attention;
use App\Support\Files\Comments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The dot on an applicant's face, and the icon that says what it is about.
 *
 * Both come from {@see Attention}, measured for one reader over a whole page
 * of clients at once.
 */
class CipAttentionTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $name, string $email, string $type = 'Administrator'): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    /** A client with its own folder, and a document inside it. */
    private function clientWithDocument(User $staff, string $name): array
    {
        $client = Client::create([
            'uid' => Str::slug($name), 'name' => $name, 'created_by' => $staff->id, 'data' => [],
        ]);
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => $name,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $folder->id,
            'name' => 'Passport.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 12, 'disk' => 'local', 'storage_path' => 'vault/p.pdf',
            'owner_id' => $staff->id, 'uploaded_by' => $staff->id,
        ]);

        return [$client, $file];
    }

    public function test_an_unread_thread_on_a_clients_document_marks_that_client(): void
    {
        $staff = $this->user('Ada Admin', 'a@example.com');
        $mate = $this->user('Bo Colleague', 'b@example.com');
        [$chen, $file] = $this->clientWithDocument($staff, 'Chen Wei');
        [$quiet] = $this->clientWithDocument($staff, 'Quiet Client');

        $comment = Comments::create($file, $staff, 'Re-scan page 2 please', null, [$mate->id]);

        $forMate = Attention::forClients($mate, [$chen->id, $quiet->id]);

        // The client with the conversation is marked; the other is absent
        // entirely, so a row with nothing waiting draws nothing.
        $this->assertSame(1, $forMate[$chen->id]['comments']);
        $this->assertTrue($forMate[$chen->id]['mentionsMe']);
        $this->assertArrayNotHasKey($quiet->id, $forMate);

        // The author has read what they themselves wrote, so their own row is
        // clean. This is the difference between unread and unresolved: the old
        // dot lit for the person who had just typed the comment.
        $this->assertSame([], Attention::forClients($staff, [$chen->id]));

        // Opening the file's comments is the reading, and it clears the dot.
        $this->actingAs($mate)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();
        $this->assertSame([], Attention::forClients($mate, [$chen->id]));

        // A reply from somebody else makes it unread again.
        Comments::create($file, $staff, 'Any update?', FileComment::findOrFail($comment->id));
        $this->assertSame(1, Attention::forClients($mate, [$chen->id])[$chen->id]['comments']);

        // Resolving it settles the thread whether or not anyone read it.
        Comments::resolve(FileComment::findOrFail($comment->id), $staff, true);
        $this->assertSame([], Attention::forClients($mate, [$chen->id]));
    }

    public function test_unread_direct_messages_from_the_clients_account_mark_that_client(): void
    {
        $staff = $this->user('Ada Admin', 'a@example.com');
        $account = $this->user('Chen Wei', 'chen@example.com', 'Client');
        [$chen] = $this->clientWithDocument($staff, 'Chen Wei');
        $chen->forceFill(['user_id' => $account->id])->save();

        $conversation = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
            'created_by' => $account->id,
            'last_message_at' => now(),
        ]);
        foreach ([$staff, $account] as $member) {
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $member->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        $conversation->messages()->create(['user_id' => $account->id, 'body' => 'Any news?']);
        $conversation->messages()->create(['user_id' => $account->id, 'body' => 'Thanks']);
        // The reader's own line is not unread correspondence to them.
        $conversation->messages()->create(['user_id' => $staff->id, 'body' => 'Looking into it']);

        $marked = Attention::forClients($staff, [$chen->id]);
        $this->assertSame(2, $marked[$chen->id]['messages']);
        $this->assertSame(0, $marked[$chen->id]['comments']);

        // The client's own account is not told it has unread mail from itself.
        $this->assertSame([], Attention::forClients($account, [$chen->id]));

        // Reading to the end clears it.
        $last = Message::where('conversation_id', $conversation->id)->max('id');
        $this->assertNotNull($last);
        ConversationParticipant::where('conversation_id', $conversation->id)
            ->where('user_id', $staff->id)
            ->update(['last_read_message_id' => $last]);

        $this->assertSame([], Attention::forClients($staff, [$chen->id]));
    }

    public function test_a_group_chat_that_happens_to_include_a_client_does_not_mark_them(): void
    {
        $staff = $this->user('Ada Admin', 'a@example.com');
        $other = $this->user('Bo Colleague', 'b@example.com');
        $account = $this->user('Chen Wei', 'chen@example.com', 'Client');
        [$chen] = $this->clientWithDocument($staff, 'Chen Wei');
        $chen->forceFill(['user_id' => $account->id])->save();

        $group = Conversation::create([
            'type' => Conversation::TYPE_GROUP,
            'created_by' => $staff->id,
            'last_message_at' => now(),
        ]);
        foreach ([$staff, $other, $account] as $member) {
            ConversationParticipant::create([
                'conversation_id' => $group->id,
                'user_id' => $member->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }
        $group->messages()->create(['user_id' => $account->id, 'body' => 'Hello all']);

        $this->assertSame([], Attention::forClients($staff, [$chen->id]));
    }

    public function test_a_system_line_is_history_rather_than_correspondence(): void
    {
        $staff = $this->user('Ada Admin', 'a@example.com');
        $account = $this->user('Chen Wei', 'chen@example.com', 'Client');
        [$chen] = $this->clientWithDocument($staff, 'Chen Wei');
        $chen->forceFill(['user_id' => $account->id])->save();

        $conversation = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
            'created_by' => $account->id,
            'last_message_at' => now(),
        ]);
        foreach ([$staff, $account] as $member) {
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $member->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }
        $conversation->messages()->create([
            'user_id' => null,
            'type' => Message::TYPE_SYSTEM,
            'system_event' => ['event' => 'call_ended', 'label' => 'Voice call'],
        ]);

        $this->assertSame([], Attention::forClients($staff, [$chen->id]));
    }
}
