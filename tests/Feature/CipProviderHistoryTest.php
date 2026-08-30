<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipDocumentComment;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\FileWorkflowStep;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\Timeline;
use App\Support\Cip\Tree;
use App\Support\Companies\CompanyMembers;
use App\Support\Files\ActivityFeed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * §12 — Service Provider history hangs off the contact, not the login.
 *
 * A comment, workflow step, document or activity written by a provider
 * contact must still be there — and still named as them — after that
 * account is deleted and the same address is invited back. The membership
 * is the row that survives; the user id is not.
 */
class CipProviderHistoryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
        Mail::fake();
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::factory()->create([
            'name' => $name,
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        return $user;
    }

    /**
     * @return array{
     *     admin: User,
     *     contact: User,
     *     member: CompanyMember,
     *     company: Company,
     *     provider: CipProvider,
     *     slot: CipDocument,
     *     file: FileItem
     * }
     */
    private function filing(): array
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.test', 'Gil Contact');
        $company = Company::create(['uid' => 'galaxy-firm', 'name' => 'Galaxy Firm', 'created_by' => $admin->id]);
        $member = CompanyMembers::add($company, [
            'name' => 'Gil Contact',
            'email' => 'gil@galaxy.test',
            'role' => 'member',
        ], $admin);
        $provider = CipProvider::create([
            'name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id,
        ]);

        $application = Applications::create($provider, $admin);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        Tree::provision($application->fresh(), $admin);

        $slot = DocumentSlots::fill(
            $application->people()->first(),
            'passport_bio_page',
            UploadedFile::fake()->create('passport.pdf', 40, 'application/pdf'),
            $contact,
        );

        return [
            'admin' => $admin,
            'contact' => $contact,
            'member' => $member->fresh(),
            'company' => $company,
            'provider' => $provider,
            'slot' => $slot->fresh(),
            'file' => $slot->fresh()->file,
        ];
    }

    private function purge(User $admin, User $contact): void
    {
        $this->actingAs($admin)->deleteJson('/admin/users/'.$contact->id)->assertOk();
        $this->actingAs($admin)->deleteJson('/portal/admin/recycle-bin/user/'.$contact->id)->assertOk();
        $this->assertNull(User::withTrashed()->find($contact->id));
    }

    private function reinvite(User $admin, Company $company): User
    {
        $again = $this->user(Role::CLIENT, 'gil@galaxy.test', 'Gil Contact');
        CompanyMembers::add($company, [
            'name' => 'Gil Contact',
            'email' => 'gil@galaxy.test',
            'role' => 'member',
        ], $admin);

        return $again;
    }

    public function test_a_contact_comment_and_upload_still_name_them_after_the_account_is_purged(): void
    {
        $ctx = $this->filing();
        $admin = $ctx['admin'];
        $contact = $ctx['contact'];
        $member = $ctx['member'];
        $slot = $ctx['slot'];
        $file = $ctx['file'];
        $application = $slot->application;

        $this->actingAs($contact)->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
            'body' => 'The original is in the post.',
        ])->assertCreated()->assertJsonPath('author.name', 'Gil Contact');

        $this->actingAs($contact)->postJson('/portal/files/files/'.$file->uuid.'/comments', [
            'body' => 'Cropped the edges.',
        ])->assertCreated()->assertJsonPath('author.name', 'Gil Contact');

        $this->actingAs($admin)->postJson('/portal/files/files/'.$file->uuid.'/workflows', [
            'type' => 'approval',
            'recipients' => [['userId' => $contact->id]],
            'message' => 'Please confirm this scan.',
        ])->assertCreated();

        $this->assertSame($member->id, CipDocumentComment::first()->company_member_id);
        $this->assertSame($member->id, FileComment::first()->company_member_id);
        $this->assertSame($member->id, FileWorkflowStep::first()->company_member_id);
        $this->assertSame($member->id, $slot->fresh()->company_member_id);

        $this->purge($admin, $contact);

        $this->assertSame(1, CipDocumentComment::count(), 'purging the login must not take the comment');
        $this->assertSame(1, FileComment::count());
        $this->assertSame(1, FileWorkflowStep::count());
        $this->assertNotNull($slot->fresh()->file_id, 'the document stays on the application');

        $thread = $this->actingAs($admin)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')
            ->assertOk()->json('comments');
        $this->assertSame('The original is in the post.', $thread[0]['body']);
        $this->assertSame('Gil Contact', $thread[0]['author']['name']);

        $fileThread = $this->actingAs($admin)
            ->getJson('/portal/files/files/'.$file->uuid.'/comments')
            ->assertOk()->json('threads');
        $this->assertSame('Cropped the edges.', $fileThread[0]['body']);
        $this->assertSame('Gil Contact', $fileThread[0]['author']['name']);

        $lines = array_column(Timeline::for($application->fresh(), $admin), 'what');
        $this->assertTrue(
            collect($lines)->contains(fn (string $line) => str_contains($line, 'Gil Contact')),
            'the Activity tab still names the contact, not the system: '.implode(' | ', $lines),
        );

        $gilOnFile = collect(ActivityFeed::page($file->fresh(), $admin)['entries'])
            ->first(fn (array $e) => ($e['actor']['name'] ?? null) === 'Gil Contact');
        $this->assertNotNull($gilOnFile, 'the file activity timeline still names the contact');

        $workflow = $this->actingAs($admin)
            ->getJson('/portal/files/files/'.$file->uuid.'/workflows')
            ->assertOk()->json();
        $this->assertSame('Gil Contact', $workflow['workflows'][0]['steps'][0]['name']);
    }

    public function test_reinviting_the_same_address_keeps_the_contact_on_their_own_history(): void
    {
        $ctx = $this->filing();
        $admin = $ctx['admin'];
        $contact = $ctx['contact'];
        $member = $ctx['member'];
        $company = $ctx['company'];
        $slot = $ctx['slot'];
        $file = $ctx['file'];

        $this->actingAs($contact)->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
            'body' => 'The original is in the post.',
        ])->assertCreated();

        $this->actingAs($admin)->postJson('/portal/files/files/'.$file->uuid.'/workflows', [
            'type' => 'approval',
            'recipients' => [['userId' => $contact->id]],
        ])->assertCreated();

        $this->purge($admin, $contact);
        $again = $this->reinvite($admin, $company);

        $this->assertSame($member->id, CompanyMember::where('company_id', $company->id)->value('id'));
        $this->assertSame($again->id, CompanyMember::find($member->id)->user_id);

        $thread = $this->actingAs($again)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')
            ->assertOk()->json('comments');
        $this->assertSame('The original is in the post.', $thread[0]['body']);
        $this->assertTrue($thread[0]['mine']);
        $this->assertTrue($thread[0]['canEdit']);

        $inbox = $this->actingAs($again)
            ->getJson('/portal/files/workflows?scope=inbox')
            ->assertOk();
        $this->assertGreaterThanOrEqual(1, $inbox->json('counts.waiting'));
        $this->assertCount(1, $inbox->json('items'));
    }

    public function test_a_binned_contact_still_names_the_comment_they_wrote(): void
    {
        $ctx = $this->filing();
        $admin = $ctx['admin'];
        $contact = $ctx['contact'];
        $slot = $ctx['slot'];

        $this->actingAs($contact)->postJson('/portal/cip/documents/'.$slot->uuid.'/comments', [
            'body' => 'Waiting on the apostille.',
        ])->assertCreated();

        $this->actingAs($admin)->deleteJson('/admin/users/'.$contact->id)->assertOk();
        $this->assertNotNull(User::withTrashed()->find($contact->id));

        $thread = $this->actingAs($admin)
            ->getJson('/portal/cip/documents/'.$slot->uuid.'/comments')
            ->assertOk()->json('comments');
        $this->assertSame('Gil Contact', $thread[0]['author']['name']);
        $this->assertSame('Waiting on the apostille.', $thread[0]['body']);
    }
}
