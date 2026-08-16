<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipDocumentComment;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * §13 — a checklist document carries a conversation.
 *
 * The thread hangs off the requirement, not off the file in it, so a question
 * about a document survives the answer to it arriving. And the provider side
 * can join: being told what is wrong with a document and replying about it is
 * the whole point of the section.
 */
class CipDocumentCommentTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $u;
    }

    /** An application with one document slot, and the provider firm behind it. */
    private function slot(User $staff, ?Company &$company = null): CipDocument
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);

        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => 'police_certificate',
            'label' => 'Police certificate',
            'required' => true,
        ]);
    }

    public function test_a_thread_comes_back_with_its_replies_under_the_root(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $slot = $this->slot($staff);

        $root = $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
                'body' => 'This scan is cut off at the bottom.',
            ])->assertCreated()->json();

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
                'body' => 'Re-scanned and sent.', 'parent' => $root['id'],
            ])->assertCreated();

        $thread = $this->actingAs($staff)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')
            ->assertOk()->json('comments');

        $this->assertCount(1, $thread, 'one conversation, not two');
        $this->assertCount(1, $thread[0]['replies']);
        $this->assertSame('Re-scanned and sent.', $thread[0]['replies'][0]['body']);
        $this->assertSame(1, $thread[0]['repliesCount']);
    }

    public function test_a_reply_to_a_reply_stays_in_the_same_conversation(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $slot = $this->slot($staff);

        $root = $this->actingAs($staff)->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
            'body' => 'Cut off.',
        ])->json();

        $reply = $this->actingAs($staff)->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
            'body' => 'Sent again.', 'parent' => $root['id'],
        ])->json();

        $this->actingAs($staff)->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
            'body' => 'Still cut off.', 'parent' => $reply['id'],
        ])->assertCreated();

        $thread = $this->actingAs($staff)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')->json('comments');

        // Flattened onto the root rather than growing a third level nobody
        // would read in a table cell.
        $this->assertCount(1, $thread);
        $this->assertCount(2, $thread[0]['replies']);
    }

    public function test_the_provider_side_can_join_the_conversation(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $company = null;
        $slot = $this->slot($staff, $company);

        // A contact at the provider firm the application was filed under.
        $contact = $this->user('Service Provider', 'contact@galaxy.example', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'role' => 'general', 'status' => 'active', 'invited_by' => $staff->id,
        ]);

        $this->actingAs($contact)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
                'body' => 'The original is in the post.',
            ])->assertCreated();

        $this->actingAs($contact)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')
            ->assertOk()
            ->assertJsonPath('comments.0.body', 'The original is in the post.');
    }

    public function test_a_stranger_is_not_told_the_document_exists(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $slot = $this->slot($staff);
        $stranger = $this->user('Client', 'nobody@example.com');

        // 404, not 403: being refused tells you it is there.
        $this->actingAs($stranger)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')
            ->assertNotFound();

        $this->actingAs($stranger)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', ['body' => 'hello'])
            ->assertNotFound();
    }

    public function test_only_the_author_may_edit_and_the_edit_is_stamped(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $other = $this->user('Reviewing Officer', 'rita@example.com', 'Rita Officer');
        $slot = $this->slot($staff);

        $comment = $this->actingAs($other)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', ['body' => 'Needs a clearer scan.'])
            ->assertCreated()->json();

        $reviewer = $this->user('Reviewing Officer', 'sam@example.com', 'Sam Bystander');
        $this->actingAs($reviewer)
            ->patchJson('/portal/cip/documents/'.$slot->uuid.'/comments/'.$comment['id'], ['body' => 'Fine actually'])
            ->assertForbidden();

        $edited = $this->actingAs($other)
            ->patchJson('/portal/cip/documents/'.$slot->uuid.'/comments/'.$comment['id'], [
                'body' => 'Needs a clearer scan of the second page.',
            ])->assertOk()->json();

        $this->assertTrue($edited['edited'], 'an edit leaves a mark on the record');
    }

    public function test_a_deleted_comment_leaves_the_thread_but_not_the_database(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $slot = $this->slot($staff);

        $comment = $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', ['body' => 'Rejected: expired.'])
            ->json();

        $this->actingAs($staff)
            ->deleteJson('/portal/cip/documents/'.$slot->uuid.'/comments/'.$comment['id'])
            ->assertOk();

        $this->assertSame([], $this->actingAs($staff)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')->json('comments'));

        // §13 retains these: a reviewer's reason for rejecting a document is
        // exactly what somebody would want gone.
        $this->assertNotNull(CipDocumentComment::withTrashed()->where('uuid', $comment['id'])->first());
    }

    public function test_a_comment_can_be_settled_and_reopened(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $slot = $this->slot($staff);

        $comment = $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', ['body' => 'Which page is the address on?'])
            ->json();

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments/'.$comment['id'].'/resolve')
            ->assertOk()->assertJsonPath('resolved', true);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments/'.$comment['id'].'/resolve', ['resolved' => false])
            ->assertOk()->assertJsonPath('resolved', false);
    }

    public function test_a_comment_uuid_from_another_document_is_not_reachable(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $slot = $this->slot($staff);

        $other = CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $slot->application_id,
            'person_id' => $slot->person_id,
            'type' => 'medical_certificate',
            'label' => 'Medical certificate',
            'required' => true,
        ]);

        $comment = $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', ['body' => 'On the first document.'])
            ->json();

        $this->actingAs($staff)
            ->patchJson('/portal/cip/documents/'.$other->uuid.'/comments/'.$comment['id'], ['body' => 'moved'])
            ->assertNotFound();
    }

    public function test_an_empty_comment_is_refused(): void
    {
        $staff = $this->user('Administrator', 'ada@example.com');
        $slot = $this->slot($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', ['body' => '   '])
            ->assertStatus(422);
    }
}
