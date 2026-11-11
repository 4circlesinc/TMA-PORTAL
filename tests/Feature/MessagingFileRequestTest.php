<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\FileRequest;
use App\Models\Folder;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentStatus;
use App\Support\Messaging\ClientConversations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * "/" then Request files in a chat, and a message's details.
 *
 * A request names an application only when everyone in the chat can see it,
 * is posted as a card listing each document, and each document is answered
 * from the card through the same code the emailed link runs: renamed, filed
 * in its slot, ticked off.
 */
class MessagingFileRequestTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Mail::fake();
    }

    private function user(string $type, string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $u;
    }

    /** A provider firm with one contact and one application with two outstanding documents. */
    private function firm(User $staff, string $uid, string $name, string $contactEmail): array
    {
        $company = Company::create(['uid' => $uid, 'name' => $name, 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => $name, 'code' => strtoupper(substr($uid, 0, 3)), 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);
        $contact = $this->user(Role::CLIENT, $contactEmail, $name.' Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => $name.' Contact', 'email' => $contactEmail,
            'role' => 'general', 'status' => CompanyMember::STATUS_ACTIVE,
            'added_by' => $staff->id,
        ]);

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

        $slot = fn (string $type, string $label) => CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => $type,
            'label' => $label,
            'required' => true,
            'status' => DocumentStatus::PENDING_UPLOAD,
        ]);

        return [$contact, $application, $slot('oath_of_allegiance', 'Oath of Allegiance'), $slot('proof_of_payment', 'Proof of payment')];
    }

    /** @return array{0: User, 1: User, 2: CipApplication, 3: CipDocument, 4: CipDocument, 5: Conversation, 6: CipApplication} */
    private function chat(): array
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$contact, $application, $oath, $payment] = $this->firm($staff, 'galaxy', 'Galaxy', 'gil@galaxy.example');
        // Another firm's file, which the Galaxy contact cannot see.
        [, $elsewhere] = $this->firm($staff, 'harbour', 'Harbour', 'hal@harbour.example');

        $conversation = ClientConversations::resolveDirect($staff, $contact);

        return [$staff, $contact, $application, $oath, $payment, $conversation, $elsewhere];
    }

    private function ask(User $as, Conversation $conversation, array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($as)->postJson('/portal/messaging/conversations/'.$conversation->uuid.'/file-requests', $payload);
    }

    private function answer(User $as, string $messageUuid, ?string $document, string $filename = 'scan_0042.pdf'): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($as)->post('/portal/messaging/messages/'.$messageUuid.'/file-request-upload', array_filter([
            'file' => UploadedFile::fake()->create($filename, 12, 'application/pdf'),
            'document' => $document,
        ]), ['Accept' => 'application/json']);
    }

    public function test_a_private_chat_offers_only_the_applications_both_people_can_see(): void
    {
        [$staff, , $application, , , $conversation, $elsewhere] = $this->chat();

        $response = $this->actingAs($staff)
            ->getJson('/portal/messaging/conversations/'.$conversation->uuid.'/file-requests/options')
            ->assertOk()
            ->assertJsonPath('canRequest', true)
            ->assertJsonPath('fixed', null);

        $ids = collect($response->json('applications'))->pluck('id')->all();
        $this->assertContains($application->uuid, $ids);
        $this->assertNotContains($elsewhere->uuid, $ids);
    }

    public function test_a_case_group_asks_about_its_own_application(): void
    {
        [$staff, $contact, $application, , , , ] = $this->chat();

        $group = Conversation::create([
            'type' => Conversation::TYPE_GROUP, 'name' => 'Chen Wei',
            'subject' => Conversation::SUBJECT_PROVIDER, 'cip_application_id' => $application->id,
            'created_by' => $staff->id,
        ]);
        $group->participants()->create(['user_id' => $staff->id, 'role' => 'admin']);
        $group->participants()->create(['user_id' => $contact->id, 'role' => 'member']);

        $this->actingAs($staff)
            ->getJson('/portal/messaging/conversations/'.$group->uuid.'/file-requests/options')
            ->assertOk()
            ->assertJsonPath('fixed.id', $application->uuid)
            ->assertJsonPath('applications', []);
    }

    public function test_asking_for_checklist_documents_posts_a_card_with_each_one(): void
    {
        [$staff, $contact, $application, $oath, $payment, $conversation] = $this->chat();

        $response = $this->ask($staff, $conversation, [
            'application' => $application->uuid,
            'documents' => [$oath->uuid, $payment->uuid],
            'message' => 'The signed copies, please.',
        ])->assertCreated()
            ->assertJsonPath('message.type', Message::TYPE_FILE_REQUEST)
            ->assertJsonPath('message.fileRequest.kind', 'documents')
            ->assertJsonPath('message.fileRequest.application.id', $application->uuid)
            ->assertJsonPath('message.fileRequest.documents.0.id', $oath->uuid)
            ->assertJsonPath('message.fileRequest.documents.0.received', false)
            ->assertJsonPath('message.fileRequest.open', true)
            ->assertJsonPath('message.fileRequest.requestedBy', $staff->id);

        $this->assertCount(2, $response->json('message.fileRequest.documents'));
        $this->assertStringContainsString('Oath of Allegiance', (string) $response->json('message.body'));

        $request = FileRequest::query()->latest('id')->firstOrFail();
        // Asked of the person in the chat, who is reminded as any recipient is.
        $this->assertSame($contact->id, (int) $request->recipient_user_id);
        $this->assertSame('The signed copies, please.', $request->message);

        // The other side sees the same card in the thread.
        $this->actingAs($contact)
            ->getJson('/portal/messaging/conversations/'.$conversation->uuid.'/messages')
            ->assertOk()
            ->assertJsonFragment(['kind' => 'documents', 'requestedBy' => $staff->id]);
    }

    public function test_an_application_somebody_in_the_chat_cannot_see_is_refused(): void
    {
        [$staff, , , , , $conversation, $elsewhere] = $this->chat();
        $slot = CipDocument::query()->where('application_id', $elsewhere->id)->firstOrFail();

        $this->ask($staff, $conversation, [
            'application' => $elsewhere->uuid,
            'documents' => [$slot->uuid],
        ])->assertStatus(422)->assertJsonValidationErrors(['application']);

        $this->assertSame(0, Message::query()->where('type', Message::TYPE_FILE_REQUEST)->count());
    }

    public function test_each_document_is_answered_from_the_card_and_filed_in_its_slot(): void
    {
        [$staff, $contact, $application, $oath, $payment, $conversation] = $this->chat();
        $uuid = $this->ask($staff, $conversation, [
            'application' => $application->uuid,
            'documents' => [$oath->uuid, $payment->uuid],
        ])->assertCreated()->json('message.id');

        $this->answer($contact, $uuid, $oath->uuid, 'IMG_2231.pdf')
            ->assertCreated()
            ->assertJsonPath('fileRequest.documents.0.received', true)
            ->assertJsonPath('fileRequest.documents.1.received', false)
            ->assertJsonPath('fileRequest.open', true);

        // Renamed and filed exactly as the emailed link would.
        $oath->refresh();
        $this->assertNotNull($oath->file_id);
        $this->assertSame('CHEN WEI - Oath of Allegiance.pdf', $oath->file->name);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $oath->status);

        // One file per document.
        $this->answer($contact, $uuid, $oath->uuid)->assertStatus(422);

        $this->answer($contact, $uuid, $payment->uuid)
            ->assertCreated()
            ->assertJsonPath('fileRequest.open', false)
            ->assertJsonPath('fileRequest.closedReason', 'complete');
    }

    public function test_somebody_outside_the_chat_cannot_answer(): void
    {
        [$staff, , $application, $oath, , $conversation] = $this->chat();
        $uuid = $this->ask($staff, $conversation, [
            'application' => $application->uuid,
            'documents' => [$oath->uuid],
        ])->json('message.id');

        $stranger = $this->user(Role::CLIENT, 'sam@example.com', 'Sam Stranger');
        $this->answer($stranger, $uuid, $oath->uuid)->assertNotFound();
        $this->assertNull($oath->fresh()->file_id);
    }

    public function test_no_application_asks_for_files_into_a_folder(): void
    {
        [$staff, $contact, , , , $conversation] = $this->chat();
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Invoices',
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);

        $uuid = $this->ask($staff, $conversation, [
            'folder' => $folder->uuid,
            'title' => 'Your October invoices',
        ])->assertCreated()
            ->assertJsonPath('message.fileRequest.kind', 'folder')
            ->assertJsonPath('message.fileRequest.folder.id', $folder->uuid)
            ->assertJsonPath('message.fileRequest.title', 'Your October invoices')
            ->json('message.id');

        $this->answer($contact, $uuid, null, 'october.pdf')
            ->assertCreated()
            ->assertJsonPath('fileRequest.received', 1);

        $this->assertTrue(\App\Models\FileItem::query()->where('folder_id', $folder->id)->where('name', 'october.pdf')->exists());
    }

    public function test_a_folder_is_required_without_an_application(): void
    {
        [$staff, , , , , $conversation] = $this->chat();

        $this->ask($staff, $conversation, ['title' => 'Anything'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['folder']);
    }

    public function test_only_staff_and_service_providers_may_ask(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $client = $this->user(Role::CLIENT, 'cat@example.com', 'Cat Client');
        $conversation = ClientConversations::resolveDirect($client, $staff);

        $this->actingAs($client)
            ->getJson('/portal/messaging/conversations/'.$conversation->uuid.'/file-requests/options')
            ->assertOk()
            ->assertJsonPath('canRequest', false);

        $this->ask($client, $conversation, ['folder' => 'anything'])->assertForbidden();
    }

    public function test_message_details_say_when_it_was_sent_and_who_has_seen_it(): void
    {
        [$staff, $contact, , , , $conversation] = $this->chat();

        $uuid = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$conversation->uuid.'/messages', ['body' => 'Morning'])
            ->assertOk()
            ->json('message.id');

        // Not opened yet: it has not reached them either.
        $this->actingAs($staff)->getJson('/portal/messaging/messages/'.$uuid.'/info')
            ->assertOk()
            ->assertJsonPath('mine', true)
            ->assertJsonPath('readBy', [])
            ->assertJsonPath('waiting.0.id', $contact->id);

        $this->actingAs($contact)->postJson('/portal/messaging/conversations/'.$conversation->uuid.'/read')->assertOk();

        $info = $this->actingAs($staff)->getJson('/portal/messaging/messages/'.$uuid.'/info')
            ->assertOk()
            ->assertJsonPath('readBy.0.id', $contact->id)
            ->assertJsonPath('waiting', [])
            ->assertJsonPath('deliveredTo', []);

        $this->assertNotEmpty($info->json('readBy.0.seenAt'));
        $this->assertNotEmpty($info->json('readBy.0.seenAtLabel'));
        $this->assertNotEmpty($info->json('sentAtLabel'));

        // Somebody outside the conversation gets nothing.
        $stranger = $this->user(Role::CLIENT, 'sam@example.com', 'Sam Stranger');
        $this->actingAs($stranger)->getJson('/portal/messaging/messages/'.$uuid.'/info')->assertNotFound();
    }
}
