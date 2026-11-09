<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileRequest;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Asking the service provider for several checklist documents in one link:
 * each file is renamed to its document and lands in its own slot.
 */
class CipDocumentListRequestTest extends TestCase
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

    /** @return array{0: User, 1: User, 2: CipApplication, 3: CipDocument, 4: CipDocument} */
    private function file(): array
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
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

        return [$staff, $contact, $application, $slot('oath_of_allegiance', 'Oath of Allegiance'), $slot('proof_of_payment', 'Proof of payment')];
    }

    private function request(User $staff, CipApplication $application, array $documents, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($staff)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/document-requests',
            array_merge(['documents' => $documents, 'to' => 'provider'], $extra),
        );
    }

    private function upload(string $token, ?string $document, string $filename = 'scan_0042.pdf'): \Illuminate\Testing\TestResponse
    {
        auth()->logout();

        return $this->post('/r/'.$token.'/upload', array_filter([
            'file' => UploadedFile::fake()->create($filename, 12, 'application/pdf'),
            'document' => $document,
        ]), ['Accept' => 'application/json']);
    }

    public function test_one_request_asks_the_provider_for_several_documents(): void
    {
        [$staff, $contact, $application, $oath, $payment] = $this->file();

        $this->request($staff, $application, [$oath->uuid, $payment->uuid])
            ->assertCreated()
            ->assertJsonPath('documents', 2)
            ->assertJsonPath('emailed', 1);

        $request = FileRequest::query()->latest('id')->firstOrFail();
        $this->assertSame(2, (int) $request->max_files);
        $this->assertSame(2, DB::table('file_request_documents')->where('file_request_id', $request->id)->count());

        // The provider contact hears in the portal as well as by email.
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id,
            'type' => 'files.request_received',
            'action_url' => '/r/'.$request->token,
        ]);

        // The page lists both documents and does not ask who they are.
        auth()->logout();
        $this->get('/r/'.$request->token)
            ->assertOk()
            ->assertSee('Oath of Allegiance')
            ->assertSee('Proof of Payment')
            ->assertDontSee('placeholder="Your name"', false);
    }

    public function test_each_upload_is_renamed_and_filed_in_its_own_slot(): void
    {
        [$staff, , $application, $oath, $payment] = $this->file();
        $this->request($staff, $application, [$oath->uuid, $payment->uuid])->assertCreated();
        $request = FileRequest::query()->latest('id')->firstOrFail();

        $this->upload($request->token, $oath->uuid, 'IMG_2231.pdf')->assertCreated();

        $oath->refresh();
        $this->assertNotNull($oath->file_id);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $oath->status);
        $this->assertSame('CHEN WEI - Oath of Allegiance.pdf', $oath->file->name);
        // The same drawer a portal upload into the slot would use.
        $this->assertSame(\App\Support\Cip\DocumentSlots::destinationForSlot($oath->fresh()), $oath->file->folder_id);

        // The other document is still waiting.
        $this->assertNull($payment->fresh()->file_id);

        // One file per document: a second for the oath is refused.
        $this->upload($request->token, $oath->uuid)->assertStatus(422);

        // A file that does not say which document it is, is refused.
        $this->upload($request->token, null)->assertStatus(422);

        $this->upload($request->token, $payment->uuid)->assertCreated();
        $this->assertNotNull($payment->fresh()->file_id);
        $this->assertSame(2, DB::table('file_request_documents')->where('file_request_id', $request->id)->whereNotNull('file_id')->count());
    }

    public function test_someone_else_needs_a_name_and_an_email(): void
    {
        [$staff, , $application, $oath] = $this->file();

        $this->request($staff, $application, [$oath->uuid], ['to' => 'someone'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['recipientName', 'recipientEmail']);

        $this->request($staff, $application, [$oath->uuid], [
            'to' => 'someone', 'recipientName' => 'Jane Doe', 'recipientEmail' => 'jane@example.com',
        ])->assertCreated()->assertJsonPath('recipients.0', 'Jane Doe');
    }

    public function test_only_staff_may_ask(): void
    {
        [, $contact, $application, $oath] = $this->file();

        $this->request($contact, $application, [$oath->uuid])->assertForbidden();
        $this->assertSame(0, FileRequest::count());
    }

    public function test_documents_from_another_application_are_refused(): void
    {
        [$staff, , $application, $oath] = $this->file();
        $other = Applications::create(CipProvider::firstOrFail(), $staff);

        $this->request($staff, $other, [$oath->uuid])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['documents']);
    }
}
