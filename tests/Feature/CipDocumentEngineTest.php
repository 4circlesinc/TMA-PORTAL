<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Status;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The document engine: a slot travels the review cycle by mapped edges only,
 * the verdicts belong to the Reviewing Officer while the upload belongs to
 * whoever may upload, and every move leaves one audit row naming the document
 * and both of its statuses. A refused move changes nothing and records
 * nothing — a rejected transition must not leave a trail suggesting it half
 * happened.
 */
class CipDocumentEngineTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
        ]);
    }

    /**
     * A private client's application with one empty slot on it.
     *
     * The client account is the uploading side — an external account holding
     * no capability at all — so the upload edge is tested against the person
     * who actually walks it.
     *
     * @return array{0: CipDocument, 1: User}
     */
    private function slot(): array
    {
        $staff = $this->user(Role::EMPLOYEE);
        $provider = CipProvider::create(['name' => 'Private clients', 'code' => 'PRI']);

        $account = $this->user(Role::CLIENT);
        $client = Client::create([
            'uid' => 'asem-habtoor', 'name' => 'Asem Habtoor',
            'user_id' => $account->id, 'created_by' => $staff->id, 'data' => [],
        ]);

        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Habtoor',
        ]);

        $document = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::BIRTH_CERTIFICATE,
            'label' => DocumentTypes::label(DocumentTypes::BIRTH_CERTIFICATE),
        ]);

        // The opening status is the column default, so it is only in memory
        // after a re-read — the same read every caller gets.
        return [$document->refresh(), $account];
    }

    /** Put a slot at a given point in the cycle without walking it there. */
    private function at(CipDocument $document, string $status): CipDocument
    {
        $document->forceFill(['status' => $status])->save();

        return $document;
    }

    public function test_moving_a_slot_keeps_the_library_file_in_step(): void
    {
        [$document, $client] = $this->slot();

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Birth certificate.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/birth.pdf',
            'owner_id' => $client->id,
            'uploaded_by' => $client->id,
        ]);
        $document->forceFill(['file_id' => $file->id])->save();

        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $client);

        $this->assertSame(
            DocumentStatus::APPLICATION_REVIEW,
            $file->fresh()->review_status,
            'The File Library reads files.review_status, so the slot and the file must agree.',
        );
    }

    public function test_an_upload_moves_the_slot_into_review(): void
    {
        [$document, $client] = $this->slot();

        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $client);

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $document->fresh()->status);
        $this->assertNotNull($document->fresh()->status_changed_at);
    }

    public function test_a_reviewer_may_request_an_update_or_approve_the_document(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);

        [$document] = $this->slot();

        $this->at($document, DocumentStatus::APPLICATION_REVIEW);
        DocumentEngine::apply($document, DocumentStatus::UPDATE_REQUIRED, $officer);
        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $document->fresh()->status);

        $this->at($document, DocumentStatus::APPLICATION_REVIEW);
        DocumentEngine::apply($document, DocumentStatus::READY_FOR_SUBMISSION, $officer);
        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $document->fresh()->status);
    }

    public function test_setting_cannot_judge_an_empty_slot(): void
    {
        [$document] = $this->slot();
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $document->status);

        try {
            DocumentEngine::set($document, DocumentStatus::READY_FOR_SUBMISSION, $this->user(Role::REVIEWING_OFFICER));
            $this->fail('An empty slot was judged.');
        } catch (\InvalidArgumentException) {
            // expected
        }

        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $document->fresh()->status);
    }

    public function test_setting_a_slot_to_update_required_moves_the_application(): void
    {
        [$document] = $this->slot();
        $this->at($document, DocumentStatus::APPLICATION_REVIEW);
        $document->loadMissing('application');
        $document->application->forceFill(['status' => Status::REVIEW_APPLICATION])->save();

        DocumentEngine::set($document, DocumentStatus::UPDATE_REQUIRED, $this->user(Role::EMPLOYEE));

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $document->fresh()->status);
        $this->assertSame(Status::UPDATE_REQUIRED, $document->application->fresh()->status);
    }

    public function test_re_uploading_returns_the_slot_to_review(): void
    {
        [$document, $client] = $this->slot();
        $this->at($document, DocumentStatus::UPDATE_REQUIRED);

        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $client);

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $document->fresh()->status);
    }

    public function test_an_approved_document_can_be_re_opened(): void
    {
        [$document] = $this->slot();
        $this->at($document, DocumentStatus::READY_FOR_SUBMISSION);

        DocumentEngine::apply($document, DocumentStatus::UPDATE_REQUIRED, $this->user(Role::REVIEWING_OFFICER));

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $document->fresh()->status);
    }

    public function test_an_unmapped_edge_is_refused_and_writes_no_event(): void
    {
        [$document] = $this->slot();
        $events = CipEvent::count();

        try {
            // Nothing is approved before it has been read: there is no edge
            // from an empty slot to a verdict.
            DocumentEngine::apply($document, DocumentStatus::READY_FOR_SUBMISSION, $this->user(Role::REVIEWING_OFFICER));
            $this->fail('An unmapped document edge was applied.');
        } catch (\InvalidArgumentException) {
            // expected
        }

        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $document->fresh()->status);
        $this->assertSame($events, CipEvent::count());
    }

    public function test_a_reader_without_the_review_capability_cannot_approve(): void
    {
        [$document, $client] = $this->slot();
        $this->at($document, DocumentStatus::APPLICATION_REVIEW);
        $events = CipEvent::count();

        // The client may see this document, and uploaded it — neither of those
        // is a verdict on it.
        try {
            DocumentEngine::apply($document, DocumentStatus::READY_FOR_SUBMISSION, $client);
            $this->fail('A reader approved a document.');
        } catch (AuthorizationException) {
            // expected
        }

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $document->fresh()->status);
        $this->assertSame($events, CipEvent::count());
    }

    public function test_a_plain_employee_cannot_drive_a_slot_they_cannot_reach(): void
    {
        [$document] = $this->slot();

        $this->expectException(AuthorizationException::class);
        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $this->user(Role::EMPLOYEE));
    }

    public function test_the_event_names_the_document_and_both_statuses(): void
    {
        [$document, $client] = $this->slot();

        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $client);

        $event = CipEvent::query()->latest('id')->first();

        $this->assertSame(DocumentEngine::ACTION_STATUS_CHANGED, $event->action);
        $this->assertSame($document->application_id, $event->application_id);
        $this->assertSame($client->id, $event->actor_id);
        $this->assertSame($document->uuid, $event->meta['document']);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $event->meta['fromStatus']);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $event->meta['toStatus']);

        // The application's own status columns stay empty: this slot moved,
        // the file did not.
        $this->assertNull($event->from_status);
        $this->assertNull($event->to_status);
    }
}
