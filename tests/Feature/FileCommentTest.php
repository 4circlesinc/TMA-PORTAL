<?php

namespace Tests\Feature;

use App\Events\FileCommentChanged;
use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Notification;
use App\Models\Share;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class FileCommentTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Administrator', string $email = 'a@example.com', string $name = 'Ada Admin'): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    private function file(User $owner, ?Folder $folder = null): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $folder?->id,
            'name' => 'Brief.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 2048, 'disk' => 'local', 'storage_path' => 'vault/brief.pdf',
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
    }

    /** An org folder every staff member can read, so several people share a file. */
    private function orgFile(User $admin): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'viewer',
        ]);

        return $this->file($admin, $folder);
    }

    public function test_a_comment_can_be_posted_and_read_back(): void
    {
        $user = $this->user();
        $file = $this->file($user);

        $this->actingAs($user)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Looks good to me.'])
            ->assertCreated()
            ->assertJsonPath('body', 'Looks good to me.')
            ->assertJsonPath('author.name', 'Ada Admin')
            ->assertJsonPath('resolved', false);

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();
        $this->assertCount(1, $res->json('threads'));
        $this->assertSame(1, $res->json('openCount'));
    }

    public function test_an_empty_comment_is_rejected(): void
    {
        $user = $this->user();
        $file = $this->file($user);

        $this->actingAs($user)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => '   '])
            ->assertStatus(422);
    }

    public function test_replies_thread_one_level_deep(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $staff = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $root = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Question about clause 4.'])
            ->json('id');

        $reply = $this->actingAs($staff)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Answered below.', 'parent' => $root])
            ->assertCreated()->json('id');

        // A reply to the reply must attach to the same root, not nest deeper.
        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Thanks.', 'parent' => $reply])
            ->assertCreated();

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();

        $this->assertCount(1, $res->json('threads'), 'everything should hang off one thread');
        $this->assertCount(2, $res->json('threads.0.replies'));
        $this->assertSame(2, $res->json('threads.0.replyCount'));
    }

    public function test_a_mention_notifies_the_named_person(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben Staff can you check this?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->assertDatabaseHas('portal_notifications', ['user_id' => $ben->id, 'type' => 'file.mention']);
    }

    /**
     * The security property that matters most here: mentioning someone must
     * never become a way to push a private file's name at them.
     */
    public function test_a_mention_of_someone_without_access_is_dropped_silently(): void
    {
        $owner = $this->user('Employee', 'owner@example.com', 'Olive Owner');
        $file = $this->file($owner);                       // private to the owner
        $stranger = $this->user('Employee', 'stranger@example.com', 'Sam Stranger');

        $this->actingAs($owner)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Sam Stranger take a look',
            'mentions' => [$stranger->id],
        ])->assertCreated();

        $this->assertDatabaseMissing('portal_notifications', ['user_id' => $stranger->id]);
        $this->assertSame(0, FileComment::first()->mentions()->count());
    }

    public function test_a_suspended_user_cannot_be_mentioned(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $ben->forceFill(['status' => 'suspended'])->save();

        $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben Staff?', 'mentions' => [$ben->id],
        ])->assertCreated();

        $this->assertSame(0, FileComment::first()->mentions()->count());
    }

    public function test_replying_notifies_the_parent_author(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $root = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Thoughts?'])->json('id');

        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Mine are these.', 'parent' => $root])
            ->assertCreated();

        $this->assertDatabaseHas('portal_notifications', ['user_id' => $admin->id, 'type' => 'file.comment_reply']);
    }

    public function test_an_author_is_never_notified_about_their_own_comment(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);

        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Note to self.'])
            ->assertCreated();

        $this->assertSame(0, Notification::where('user_id', $admin->id)->count());
    }

    public function test_only_the_author_may_edit_a_comment(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $id = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'First draft'])->json('id');

        // Even an administrator may not rewrite somebody else's words.
        $this->actingAs($admin)
            ->patchJson("/portal/files/files/{$file->uuid}/comments/{$id}", ['body' => 'Edited by admin'])
            ->assertForbidden();

        $this->actingAs($ben)
            ->patchJson("/portal/files/files/{$file->uuid}/comments/{$id}", ['body' => 'Second draft'])
            ->assertOk()
            ->assertJsonPath('body', 'Second draft')
            ->assertJsonPath('editedAt', fn ($v) => $v !== null);
    }

    public function test_deleting_blanks_the_body_but_keeps_the_thread(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $root = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Sensitive text'])->json('id');
        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'A reply', 'parent' => $root])
            ->assertCreated();

        $this->actingAs($ben)->deleteJson("/portal/files/files/{$file->uuid}/comments/{$root}")->assertOk();

        // The words are gone from storage, not merely hidden.
        $row = FileComment::withTrashed()->where('uuid', $root)->first();
        $this->assertSame('', $row->body);
        $this->assertNotNull($row->deleted_at);

        // The reply survives so the conversation still makes sense.
        $this->assertSame(1, FileComment::where('file_id', $file->id)->whereNotNull('parent_id')->count());
    }

    public function test_a_file_deleter_can_moderate_someone_elses_comment(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $id = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Off topic'])->json('id');

        $this->actingAs($admin)->deleteJson("/portal/files/files/{$file->uuid}/comments/{$id}")->assertOk();
    }

    public function test_resolving_marks_the_thread_and_notifies_its_author(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');

        $id = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Is this final?'])->json('id');

        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments/{$id}/resolve", ['resolved' => true])
            ->assertOk()
            ->assertJsonPath('resolved', true)
            ->assertJsonPath('resolvedBy', 'Ada Admin');

        $this->assertDatabaseHas('portal_notifications', ['user_id' => $ben->id, 'type' => 'file.comment_resolved']);

        // A resolved thread drops out of the open count but stays readable.
        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();
        $this->assertSame(0, $res->json('openCount'));
        $this->assertCount(1, $res->json('threads'));
    }

    public function test_a_reply_cannot_be_resolved(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);

        $root = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Root'])->json('id');
        $reply = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Reply', 'parent' => $root])->json('id');

        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments/{$reply}/resolve", ['resolved' => true])
            ->assertStatus(422);
    }

    public function test_someone_without_file_access_cannot_read_or_write_comments(): void
    {
        $owner = $this->user('Employee', 'owner@example.com', 'Olive Owner');
        $stranger = $this->user('Employee', 'stranger@example.com', 'Sam Stranger');
        $file = $this->file($owner);

        $this->actingAs($stranger)->getJson("/portal/files/files/{$file->uuid}/comments")->assertForbidden();
        $this->actingAs($stranger)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'hello'])
            ->assertForbidden();
    }

    /** A viewer-level share is enough to join the discussion. */
    public function test_a_viewer_may_comment(): void
    {
        $owner = $this->user('Employee', 'owner@example.com', 'Olive Owner');
        $guest = $this->user('Employee', 'guest@example.com', 'Gus Guest');
        $file = $this->file($owner);

        Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id, 'shared_by' => $owner->id,
            'kind' => 'user', 'target_user_id' => $guest->id, 'role' => 'viewer',
        ]);

        $this->actingAs($guest)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Can I suggest a change?'])
            ->assertCreated();
    }

    public function test_a_comment_uuid_from_another_file_is_not_reachable(): void
    {
        $admin = $this->user();
        $fileA = $this->file($admin);
        $fileB = $this->file($admin);

        $id = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$fileA->uuid}/comments", ['body' => 'On A'])->json('id');

        $this->actingAs($admin)
            ->patchJson("/portal/files/files/{$fileB->uuid}/comments/{$id}", ['body' => 'hijacked'])
            ->assertNotFound();
    }

    public function test_comments_appear_in_the_file_activity_timeline(): void
    {
        $admin = $this->user();
        $file = $this->orgFile($admin);

        $root = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'A note'])->json('id');
        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'A reply', 'parent' => $root]);
        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments/{$root}/resolve", ['resolved' => true]);

        $res = $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/activity?filter=comments")->assertOk();

        $actions = array_column($res->json('entries'), 'action');
        $this->assertEqualsCanonicalizing(
            ['comment', 'comment-reply', 'comment-resolved'],
            $actions,
        );
    }

    public function test_posting_broadcasts_to_others_only(): void
    {
        Event::fake([FileCommentChanged::class]);

        $admin = $this->user();
        $file = $this->orgFile($admin);

        $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Live'])
            ->assertCreated();

        Event::assertDispatched(FileCommentChanged::class, function (FileCommentChanged $e) use ($file) {
            return $e->file->id === $file->id && $e->action === 'created';
        });
    }

    public function test_mentionable_people_are_limited_to_those_who_can_open_the_file(): void
    {
        $owner = $this->user('Employee', 'owner@example.com', 'Olive Owner');
        $file = $this->file($owner);
        $this->user('Employee', 'stranger@example.com', 'Sam Stranger');
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');

        $res = $this->actingAs($owner)
            ->getJson("/portal/files/files/{$file->uuid}/mentionable")->assertOk();

        $emails = array_column($res->json('people'), 'email');
        // Administrators can reach every file; the unrelated employee cannot.
        $this->assertContains($admin->email, $emails);
        $this->assertNotContains('stranger@example.com', $emails);
    }
}
