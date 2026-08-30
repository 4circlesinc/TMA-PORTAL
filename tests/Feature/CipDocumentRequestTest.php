<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentRequests;
use App\Support\Cip\DocumentStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * §11 — a direct upload link that fills exactly one checklist slot.
 *
 * The tokenised flow already existed for folders. What is new is that a link
 * can be aimed at a REQUIREMENT, and that a second upload through it becomes
 * the next version of the same document rather than a second file beside it.
 */
class CipDocumentRequestTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function slot(User $staff): CipDocument
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Main Applicant',
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);

        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
            'folder_id' => $folder->id,
        ]);

        return CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => 'police_certificate',
            'label' => 'Police certificate',
            'required' => true,
            'status' => DocumentStatus::PENDING_UPLOAD,
        ]);
    }

    private function send(string $token, string $filename = 'certificate.pdf'): \Illuminate\Testing\TestResponse
    {
        return $this->post('/r/'.$token.'/upload', [
            'file' => UploadedFile::fake()->create($filename, 12, 'application/pdf'),
            'name' => 'Chen Wei',
            'email' => 'chen@example.com',
        ]);
    }

    public function test_a_link_upload_lands_in_the_slot_and_puts_it_in_front_of_a_reviewer(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);

        $link = DocumentRequests::for($slot, $staff);
        $this->send($link->token)->assertStatus(201);

        $slot->refresh();
        $this->assertNotNull($slot->file_id, 'the requirement is answered');
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->status);

        /*
         * Through the engine like every other transition, so it is on the
         * record next to the ones a signed-in reviewer made.
         *
         * Asserted on the event's meta, not on from_status/to_status: those
         * columns are the APPLICATION's status, and a document's journey
         * written into them would make the two indistinguishable to anything
         * reading the trail.
         */
        $event = CipEvent::where('application_id', $slot->application_id)
            ->where('action', \App\Support\Cip\DocumentEngine::ACTION_STATUS_CHANGED)
            ->latest('id')->first();

        $this->assertNotNull($event);
        $this->assertSame($slot->uuid, $event->meta['document']);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $event->meta['fromStatus']);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $event->meta['toStatus']);
        $this->assertSame('link_upload', $event->meta['reason']);
    }

    public function test_a_second_upload_is_the_next_version_of_the_same_file(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);
        $link = DocumentRequests::for($slot, $staff, ['max_files' => 5, 'allow_multiple' => true]);

        $this->send($link->token, 'first.pdf')->assertStatus(201);
        $first = $slot->refresh()->file_id;

        $this->send($link->token, 'second.pdf')->assertStatus(201);
        $second = $slot->refresh()->file_id;

        $this->assertSame($first, $second, 'one requirement, one file — not two');
        $this->assertSame(1, FileItem::count(), 'and no stray second document in the folder');
        $this->assertSame(2, FileVersion::where('file_id', $first)->count(), 'v1 and v2 in one chain');
    }

    public function test_the_version_note_names_who_actually_sent_it(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);
        $link = DocumentRequests::for($slot, $staff);

        $this->send($link->token)->assertStatus(201);

        $version = FileVersion::where('file_id', $slot->refresh()->file_id)->first();

        // There is no account behind a token, so the requester owns the chain
        // and the visitor's name is the only record of who sent the bytes.
        $this->assertStringContainsString('Chen Wei', (string) $version->note);
    }

    public function test_a_document_link_takes_one_file_by_default(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);
        $link = DocumentRequests::for($slot, $staff);

        $this->assertSame(1, (int) $link->max_files);
        $this->assertFalse((bool) $link->allow_multiple);
    }

    public function test_a_revoked_link_is_refused_and_the_slot_is_untouched(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);
        $link = DocumentRequests::for($slot, $staff);

        $link->forceFill(['revoked_at' => now()])->save();
        $this->send($link->token)->assertStatus(410);

        $slot->refresh();
        $this->assertNull($slot->file_id);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $slot->status, 'a refused upload moves nothing');
    }

    public function test_an_expired_link_is_refused(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);
        $link = DocumentRequests::for($slot, $staff);

        $link->forceFill(['expires_at' => now()->subDay()])->save();
        $this->send($link->token)->assertStatus(410);

        $this->assertNull($slot->refresh()->file_id);
    }

    public function test_a_re_upload_after_a_reviewer_sent_it_back_starts_the_loop_again(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);
        $link = DocumentRequests::for($slot, $staff, ['max_files' => 5, 'allow_multiple' => true]);

        $this->send($link->token, 'first.pdf')->assertStatus(201);

        // The reviewer sends it back — §12's update_required.
        \App\Support\Cip\DocumentEngine::apply(
            $slot->refresh(), DocumentStatus::UPDATE_REQUIRED, $staff, ['reason' => 'illegible'],
        );

        $this->send($link->token, 'clearer.pdf')->assertStatus(201);

        $this->assertSame(
            DocumentStatus::APPLICATION_REVIEW,
            $slot->refresh()->status,
            'the re-upload back-edge is what makes the revision loop work',
        );
    }

    public function test_a_folder_link_still_behaves_exactly_as_it_did(): void
    {
        $staff = $this->staff();
        $slot = $this->slot($staff);

        // No document on this one: the ordinary flow, which makes a new file
        // every time and knows nothing about checklists.
        $link = \App\Models\FileRequest::create([
            'uuid' => (string) Str::uuid(),
            'token' => \App\Support\Files\FileRequests::token(),
            'title' => 'Anything you have',
            'folder_id' => $slot->person->folder_id,
            'created_by' => $staff->id,
            'max_files' => 5,
            'allow_multiple' => true,
        ]);

        $this->send($link->token, 'one.pdf')->assertStatus(201);
        $this->send($link->token, 'two.pdf')->assertStatus(201);

        $this->assertSame(2, FileItem::count(), 'two files, because nothing said otherwise');
        $this->assertNull($slot->refresh()->file_id, 'and no checklist was touched');
    }
}
