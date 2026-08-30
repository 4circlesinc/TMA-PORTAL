<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Engine;
use App\Support\Cip\Review;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * §14 — the officer works the checklist, and the application follows.
 *
 * The two halves of that sentence are what these tests hold apart. A verdict
 * is on ONE document, and the application's status is never typed in beside
 * it: it is read off the checklist afterwards, and only ever along an edge the
 * lifecycle already allows. One file in Update required is the application
 * in Updates Required. An optional document cannot hold Ready to submit
 * open, and a reason is not something a reviewer may leave out.
 */
class CipReviewTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    /**
     * An application filed under a provider firm, parked at the status the
     * officer would meet it at.
     *
     * Parked rather than walked: these tests are about what a verdict does to
     * an application, and walking one through submission and assignment first
     * would be testing the transitions that get it there instead.
     */
    private function application(User $staff, string $status, ?Company &$company = null): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);

        $application = Applications::create($provider, $staff);
        $application->forceFill(['status' => $status])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application;
    }

    /** One checklist slot, at a given point in the review cycle. */
    private function slot(
        CipApplication $application,
        string $type,
        string $label,
        bool $required = true,
        string $status = DocumentStatus::APPLICATION_REVIEW,
    ): CipDocument {
        $slot = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $application->people()->value('id'),
            'type' => $type,
            'label' => $label,
            'required' => $required,
        ]);

        $slot->forceFill(['status' => $status])->save();

        return $slot;
    }

    /**
     * The reviewing officer, on the file.
     *
     * On it explicitly, because holding the file is what seeing it means now:
     * officers read only the applications they have been given (§10 — the
     * administrator assigns, and an unassigned file is the administrator's).
     * These tests are about the review verbs, and a reviewer exercises them
     * on a file that is theirs.
     */
    private function officer(?CipApplication $holds = null): User
    {
        $officer = User::firstWhere('email', 'rita@example.com')
            ?? $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');

        if ($holds !== null) {
            CipApplicationAssignment::firstOrCreate([
                'application_id' => $holds->id,
                'user_id' => $officer->id,
                'status' => CipApplicationAssignment::STATUS_ACTIVE,
            ], [
                'role' => 'reviewing_officer',
                'assigned_by' => $officer->id,
                'starts_at' => now(),
            ]);
        }

        return $officer;
    }

    /** A contact at the firm that filed the application. */
    private function contact(Company $company, User $staff): User
    {
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'role' => 'general', 'status' => 'active', 'invited_by' => $staff->id,
        ]);

        return $contact;
    }

    public function test_approving_a_document_sent_back_marks_it_ready_for_submission(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::UPDATE_REQUIRED);
        $passport = $this->slot(
            $application, 'passport_bio_page', 'Passport bio page', true, DocumentStatus::UPDATE_REQUIRED,
        );
        $this->slot(
            $application, 'birth_certificate', 'Birth certificate', true, DocumentStatus::UPDATE_REQUIRED,
        );

        $body = $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk()
            ->json();

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $passport->fresh()->status);
        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $body['document']['status']);
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
    }

    public function test_approving_a_document_moves_the_slot_and_leaves_the_application_alone(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $this->slot($application, 'birth_certificate', 'Birth certificate');

        $body = $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk()->json();

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $passport->fresh()->status);
        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $body['document']['status']);

        // One document cleared is not an assessment finished, and the file
        // must not tell the provider side otherwise.
        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);
        $this->assertSame(Status::REVIEW_APPLICATION, $body['application']['status']);
        $this->assertSame(1, $body['progress']['outstanding']);
        $this->assertFalse($body['progress']['complete']);
    }

    public function test_approving_the_last_required_document_reaches_ready_to_submit(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $birth = $this->slot($application, 'birth_certificate', 'Birth certificate');

        $officer = $this->officer($application);

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')->assertOk();

        $body = $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$birth->uuid.'/approve')
            ->assertOk()->json();

        // §14 then §15: every document assessed, so Assessment feedback, and
        // nothing sent back, so the file proceeds to Ready to submit.
        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
        $this->assertSame(Status::READY_TO_SUBMIT, $body['application']['status']);
        $this->assertTrue($body['progress']['complete']);
        $this->assertSame(0, $body['progress']['outstanding']);

        $this->assertEquals(
            [Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT],
            CipEvent::query()
                ->where('application_id', $application->id)
                ->where('action', CipEvent::ACTION_STATUS_CHANGED)
                ->orderBy('id')
                ->pluck('to_status')
                ->all(),
        );
    }

    public function test_an_optional_document_outstanding_does_not_hold_the_assessment_open(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');

        // Asked for, never demanded — and nobody has uploaded it.
        $this->slot($application, 'translation', 'Certified translation', false, DocumentStatus::PENDING_UPLOAD);

        $body = $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk()->json();

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
        $this->assertSame(2, $body['progress']['total']);
        $this->assertSame(1, $body['progress']['required']);
        $this->assertSame(1, $body['progress']['counts'][DocumentStatus::PENDING_UPLOAD]);
    }

    public function test_a_filed_document_in_application_review_blocks_ready_to_submit(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $this->slot($application, 'translation', 'Certified translation', false, DocumentStatus::APPLICATION_REVIEW);

        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk();

        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::READY_TO_SUBMIT,
            ])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'This application cannot be Ready to Submit while documents are still in Application review or Update required.']);

        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);
        $this->assertNotContains(
            Status::READY_TO_SUBMIT,
            Engine::availableTransitions($application->fresh(), $staff),
        );
        $this->assertNotContains(
            Status::READY_TO_SUBMIT,
            Engine::availableOverrides($application->fresh(), $staff),
        );
    }

    public function test_moving_a_file_back_to_application_review_leaves_ready_to_submit(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::READY_TO_SUBMIT);
        $passport = $this->slot(
            $application, 'passport_bio_page', 'Passport bio page', true, DocumentStatus::READY_FOR_SUBMISSION,
        );

        Review::settle($application->fresh());
        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);

        $passport->forceFill(['status' => DocumentStatus::APPLICATION_REVIEW])->save();
        Review::settle($application->fresh());

        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);
    }

    public function test_requesting_changes_sends_the_slot_back_and_writes_the_reason(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::ASSESSMENT_FEEDBACK);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');

        $officer = $this->officer($application);

        $body = $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/request-changes', [
                'comment' => 'The bottom edge of the scan is cut off.',
            ])->assertOk()->json();

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $passport->fresh()->status);
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->assertSame(1, $body['document']['openComments']);

        // The reason is in the document's own thread, where the provider side
        // reads it — not in a status label they have to guess at.
        $this->assertSame(
            'The bottom edge of the scan is cut off.',
            $this->actingAs($officer)
                ->getJson('/portal/cip/documents/'.$passport->uuid.'/comments')
                ->json('comments.0.body'),
        );
    }

    public function test_a_document_sent_back_before_the_rest_are_read_puts_the_application_in_updates_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $this->slot($application, 'birth_certificate', 'Birth certificate');

        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/request-changes', [
                'comment' => 'Page two is missing.',
            ])->assertOk();

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $passport->fresh()->status);

        // One file in Update required is the application in Updates Required,
        // even while another required slot is still unread.
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
    }

    public function test_an_optional_file_sent_back_still_puts_the_application_in_updates_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $translation = $this->slot($application, 'translation', 'Certified translation', false);

        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$translation->uuid.'/request-changes', [
                'comment' => 'The stamp is not visible.',
            ])->assertOk();

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $translation->fresh()->status);
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
    }

    public function test_a_request_with_no_reason_is_refused_and_nothing_moves(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::ASSESSMENT_FEEDBACK);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');

        $officer = $this->officer($application);

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/request-changes')
            ->assertStatus(422);

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/request-changes', ['comment' => '   '])
            ->assertStatus(422);

        // "Update required" with no reason is a reviewer making the provider
        // guess, so the refusal has to take the verdict with it.
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $passport->fresh()->status);
        $this->assertSame(Status::ASSESSMENT_FEEDBACK, $application->fresh()->status);
        $this->assertSame(0, $passport->comments()->count());
    }

    public function test_a_slot_nothing_has_been_uploaded_into_cannot_be_approved(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot(
            $application, 'passport_bio_page', 'Passport bio page', true, DocumentStatus::PENDING_UPLOAD,
        );

        // Nothing is approved before it has been read. The cycle has no edge
        // for it, and the officer is told so in a sentence rather than a 500.
        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertStatus(422);

        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $passport->fresh()->status);
    }

    public function test_approving_a_document_twice_is_the_state_it_already_is(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');

        $officer = $this->officer($application);

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')->assertOk();

        // A double-click on a checklist row, or a second officer clearing what
        // a colleague cleared a moment ago. Neither is a second verdict.
        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::READY_FOR_SUBMISSION)
            ->assertJsonPath('application.status', Status::READY_TO_SUBMIT);
    }

    public function test_a_provider_contact_cannot_approve_their_own_document(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::REVIEW_APPLICATION, $company);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');

        // 403 and not 404: they uploaded it, they can see it on their own
        // checklist, and being told plainly that the verdict is not theirs
        // beats a page that pretends the document is gone.
        $this->actingAs($this->contact($company, $staff))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertForbidden();

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $passport->fresh()->status);
    }

    public function test_a_stranger_is_not_told_the_document_exists(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');

        $this->actingAs($this->user(Role::CLIENT, 'nobody@example.com'))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertNotFound();
    }

    public function test_a_re_upload_returns_the_slot_to_review_and_the_application_follows(): void
    {
        Storage::fake(config('filesystems.files_disk', 'local'));

        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::UPDATE_REQUIRED, $company);
        $contact = $this->contact($company, $staff);

        $this->slot($application, 'birth_certificate', 'Birth certificate', true, DocumentStatus::READY_FOR_SUBMISSION);
        $passport = $this->slot(
            $application, 'passport_bio_page', 'Passport bio page', true, DocumentStatus::UPDATE_REQUIRED,
        );

        // Phase 3's back-edge, walked by the path that actually walks it: the
        // upload is the transition.
        DocumentSlots::fill(
            $application->people()->first(),
            'passport_bio_page',
            UploadedFile::fake()->create('rescan.pdf', 40, 'application/pdf'),
            $contact,
        );

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $passport->fresh()->status);

        // A better scan arriving is not a verdict on it, so the file stays
        // where the last verdict left it until somebody reads the new one.
        Review::settle($application->fresh());
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        $this->actingAs($this->officer($application))
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk()
            ->assertJsonPath('application.status', Status::READY_TO_SUBMIT);

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);
    }

    public function test_progress_counts_every_status_whether_or_not_anything_sits_in_it(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $application = $this->application($staff, Status::REVIEW_APPLICATION);
        $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $this->slot($application, 'birth_certificate', 'Birth certificate', true, DocumentStatus::PENDING_UPLOAD);

        $progress = Review::progress($application);

        // Every status has a key, so a bar built from this cannot lose a
        // segment on the day nothing happens to sit in it.
        foreach (DocumentStatus::ALL as $status) {
            $this->assertArrayHasKey($status, $progress['counts']);
        }

        $this->assertSame(2, $progress['total']);
        $this->assertSame(2, $progress['outstanding']);
        $this->assertSame(0, $progress['counts'][DocumentStatus::READY_FOR_SUBMISSION]);
    }

    public function test_updates_required_notifies_the_provider_side_once_per_episode(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::REVIEW_APPLICATION, $company);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $birth = $this->slot($application, 'birth_certificate', 'Birth certificate');
        $officer = $this->officer($application);

        // The firm's people: one member with an account, and the registry's
        // own contact mailbox that no member owns.
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $application->provider->forceFill(['contact_email' => 'notices@galaxy.example', 'contact_name' => 'Galaxy Notices'])->save();

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$birth->uuid.'/approve')->assertOk();

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/request-changes', [
                'comment' => 'The bottom edge of the scan is cut off.',
            ])->assertOk();

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        /*
         * §14: the provider is told, in §22's filing format, with the reason
         * in the body — the promise is that nobody has to click through
         * documents to learn what needs work.
         */
        $expected = 'RO - UPDATE REQUIRED - '.$application->fresh()->displayNumber()
            .' - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->hasTo('gil@galaxy.example')
                && str_contains($mail->payload['bodyHtml'], 'Passport bio page')
                && str_contains($mail->payload['bodyHtml'], 'The bottom edge of the scan is cut off.');
        });
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('notices@galaxy.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com')
            && $mail->subjectLine === $expected);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com')
            && $mail->subjectLine === $expected);

        $assessment = 'RO - ASSESSMENT FEEDBACK - '.$application->fresh()->displayNumber()
            .' - CHEN WEI (F1) - '.now()->format('d.m.Y');
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->subjectLine === $assessment
            && $mail->hasTo('gil@galaxy.example'));

        // Assessment feedback then Update required, each to the four classes.
        Mail::assertQueuedCount(8);

        // Tracked against the file, and the bell raised for the member.
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'gil@galaxy.example', 'template' => 'cip-updates-required',
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.updates-required',
        ]);

        /*
         * A second document sent back while the file already stands at
         * Updates required joins the same open episode: the checklist names
         * it, and the notice already said there is work. Two emails saying
         * pieces of one fact would teach the firm to skim them.
         */
        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$birth->uuid.'/request-changes', [
                'comment' => 'The certificate is the short form.',
            ])->assertOk();

        Mail::assertQueuedCount(8);
    }

    public function test_reaching_ready_to_submit_notifies_the_provider_side(): void
    {
        Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $company = null;
        $application = $this->application($staff, Status::REVIEW_APPLICATION, $company);
        $passport = $this->slot($application, 'passport_bio_page', 'Passport bio page');
        $officer = $this->officer($application);

        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$passport->uuid.'/approve')
            ->assertOk();

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);

        $expected = 'RO - READY TO SUBMIT - '.$application->fresh()->displayNumber()
            .' - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->hasTo('gil@galaxy.example')
                && str_contains($mail->payload['lead'] ?? '', 'ready to submit');
        });
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com')
            && $mail->subjectLine === $expected);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com')
            && $mail->subjectLine === $expected);
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'gil@galaxy.example', 'template' => 'cip-ready-to-submit',
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.ready-to-submit',
        ]);
    }
}
