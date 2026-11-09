<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A file that arrived in Messages goes straight into a library folder, with
 * the checks an upload gets, and without leaving the chat.
 */
class SaveAttachmentToFolderTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-vault-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
        Storage::forgetDisk('local');
    }

    protected function tearDown(): void
    {
        if (is_dir($this->vaultRoot)) {
            exec('rm -rf '.escapeshellarg($this->vaultRoot));
        }
        parent::tearDown();
    }

    private function user(string $type = 'Administrator'): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @return array{0: MessageAttachment, 1: Conversation} */
    private function attachmentFor(User ...$members): array
    {
        $conversation = Conversation::create([
            'type' => Conversation::TYPE_GROUP,
            'name' => 'Case',
            'created_by' => $members[0]->id,
            'last_message_at' => now(),
        ]);
        foreach ($members as $member) {
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $member->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'user_id' => $members[0]->id,
            'type' => Message::TYPE_ATTACHMENT,
            'body' => null,
        ]);

        $path = 'messaging/'.Str::uuid().'.pdf';
        Storage::disk('local')->put($path, "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");

        $attachment = MessageAttachment::create([
            'uuid' => (string) Str::uuid(),
            'message_id' => $message->id,
            'conversation_id' => $conversation->id,
            'uploaded_by' => $members[0]->id,
            'disk' => 'local',
            'path' => $path,
            'name' => 'Bank letter.pdf',
            'mime' => 'application/pdf',
            'extension' => 'pdf',
            'status' => MessageAttachment::STATUS_READY,
            'size' => 64,
        ]);

        return [$attachment, $conversation];
    }

    private function folder(User $owner, string $name = 'Main Applicant'): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
    }

    public function test_a_message_attachment_is_saved_into_a_folder(): void
    {
        $admin = $this->user();
        [$attachment] = $this->attachmentFor($admin);
        $folder = $this->folder($admin);

        $this->actingAs($admin)
            ->postJson('/portal/messaging/attachments/'.$attachment->uuid.'/save', ['folderId' => $folder->uuid])
            ->assertCreated()
            ->assertJsonPath('file.name', 'Bank letter.pdf')
            ->assertJsonPath('folder.id', $folder->uuid);

        $file = FileItem::where('folder_id', $folder->id)->firstOrFail();
        $this->assertSame('pdf', $file->extension);
        $this->assertSame($admin->id, $file->uploaded_by);

        // The original stays in the chat.
        $this->assertNotNull($attachment->fresh());

        // Saved twice, the second keeps both, the folder's own rule for a name clash.
        $this->actingAs($admin)
            ->postJson('/portal/messaging/attachments/'.$attachment->uuid.'/save', ['folderId' => $folder->uuid])
            ->assertCreated();
        $this->assertSame(2, FileItem::where('folder_id', $folder->id)->count());
        $this->assertNotSame(
            ...FileItem::where('folder_id', $folder->id)->pluck('name')->all(),
        );
    }

    public function test_a_folder_the_reader_cannot_add_to_is_refused(): void
    {
        $admin = $this->user();
        $client = $this->user('Client');
        [$attachment] = $this->attachmentFor($client, $admin);
        $private = $this->folder($admin, 'Private');

        $this->actingAs($client)
            ->postJson('/portal/messaging/attachments/'.$attachment->uuid.'/save', ['folderId' => $private->uuid])
            ->assertForbidden();

        $this->assertSame(0, FileItem::where('folder_id', $private->id)->count());
    }

    public function test_an_attachment_from_a_conversation_the_reader_is_not_in_is_not_found(): void
    {
        $owner = $this->user();
        $outsider = $this->user();
        [$attachment] = $this->attachmentFor($owner);
        $folder = $this->folder($outsider);

        $this->actingAs($outsider)
            ->postJson('/portal/messaging/attachments/'.$attachment->uuid.'/save', ['folderId' => $folder->uuid])
            ->assertNotFound();
    }
}
