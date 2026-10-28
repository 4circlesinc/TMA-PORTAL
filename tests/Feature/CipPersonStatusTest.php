<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Confirmation;
use App\Support\Cip\Decision;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Engine;
use App\Support\Cip\NicRequirements;
use App\Support\Cip\Pack;
use App\Support\Cip\PassportRequirements;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Requirements;
use App\Support\Cip\Review;
use App\Support\Cip\Stages;
use App\Support\Cip\Status;
use App\Support\Cip\Timeline;
use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The individual rules beside the main ones.
 *
 * The application walks the post-approval lane on its checklist and its
 * recorded dates. Each person on it wears the same lane's statuses, and
 * these are the rules that say which: the file's step, read through the
 * person's own documents, plus any NIC or passport step recorded for them
 * alone. Every step forward, for a person as for the file, needs the
 * documents it hands over to be Ready for submission.
 */
class CipPersonStatusTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
        CipDocumentRequirement::query()->forceDelete();
        Requirements::flush();
        (new CipDocumentRequirementSeeder)->syncPostApproval();
    }

    private function staff(string $type = Role::ADMINISTRATOR): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            // Administrators start with provider-email copies off (Cip\Copies); these have them on.
            'preferences' => $type === Role::ADMINISTRATOR ? ['notifyProviderCopies' => true] : null,
        ]);
    }

    private function provider(): CipProvider
    {
        $company = Company::query()->firstOrCreate(['uid' => 'gal-firm'], ['name' => 'GAL Provider']);

        return CipProvider::query()->firstOrCreate(
            ['code' => 'GAL'],
            ['name' => 'GAL Provider', 'company_id' => $company->id],
        );
    }

    /**
     * A granted family of three, just entered into post-approval.
     *
     * @return array{0: CipApplication, 1: CipPerson, 2: CipPerson, 3: CipPerson}  file, main, spouse, child
     */
    private function family(User $staff): array
    {
        $application = Applications::create($this->provider(), $staff);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(40),
        ]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => CipPerson::RELATIONSHIP_SPOUSE,
            'first_name' => 'Amira',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(38),
        ]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
            'first_name' => 'Noor',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(10),
        ]);

        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now(),
        ])->save();

        PostApproval::enter($application->fresh(['people']), $staff);

        return $this->reread($application);
    }

    /** @return array{0: CipApplication, 1: CipPerson, 2: CipPerson, 3: CipPerson} */
    private function reread(CipApplication $application): array
    {
        $application = $application->fresh(['people']);
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $spouse = $application->people->firstWhere('first_name', 'AMIRA');
        $child = $application->people->firstWhere('first_name', 'NOOR');

        return [$application, $main, $spouse, $child];
    }

    /** The lane's decision, recorded the way the portal records it. */
    private function approve(CipApplication $application, User $staff): CipApplication
    {
        return Decision::record(
            $application->fresh(),
            $staff,
            Status::POST_APPROVED,
            null,
            '',
            $this->cipDecisionLetterPdf(),
        );
    }

    /** @return \Illuminate\Support\Collection<int, CipDocument> */
    private function slots(CipApplication $application, CipPerson $person, string $pack, bool $requiredOnly = true)
    {
        return Review::constrainToPack(
            CipDocument::query()
                ->where('application_id', $application->id)
                ->where('person_id', $person->id)
                ->when($requiredOnly, fn ($q) => $q->where('required', true)),
            $pack,
            $application->fresh(),
        )->orderBy('id')->get();
    }

    private function file(CipPerson $person, CipDocument $slot, User $staff): void
    {
        $upload = $slot->type === DocumentTypes::PASSPORT_PHOTO
            ? UploadedFile::fake()->image('photo.jpg', 400, 400)
            : UploadedFile::fake()->create($slot->type.'.pdf', 40, 'application/pdf');

        DocumentSlots::fill($person->fresh(['application', 'documents']), $slot->type, $upload, $staff);
    }

    /** File and accept everything this person is required to hand over for one pack. */
    private function ready(CipApplication $application, CipPerson $person, User $staff, string $pack = Pack::COR): void
    {
        foreach ($this->slots($application, $person, $pack) as $slot) {
            if (! $slot->file_id) {
                $this->file($person, $slot, $staff);
            }

            if ($slot->fresh()->status !== DocumentStatus::READY_FOR_SUBMISSION) {
                $this->actingAs($staff)
                    ->postJson('/portal/cip/documents/'.$slot->uuid.'/approve')
                    ->assertOk();
            }
        }
    }

    private function contactOn(CipApplication $application, User $staff): User
    {
        $contact = $this->staff(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $application->provider->company_id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        return $contact;
    }

    /**
     * The whole family at Apply for NIC: COR collected, confirmed, sent and
     * received.
     *
     * @return array{0: CipApplication, 1: CipPerson, 2: CipPerson, 3: CipPerson}
     */
    private function atApplyForNic(User $staff): array
    {
        [$application, $main, $spouse, $child] = $this->family($staff);

        foreach ([$main, $spouse, $child] as $person) {
            $this->ready($application, $person, $staff);
        }

        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));
        Stages::record($application->fresh(), $staff, Stages::COR_SUBMITTED, Carbon::parse('2026-08-20'));
        Stages::record($application->fresh(), $staff, Stages::COR_RECEIVED, Carbon::parse('2026-08-21'));
        Engine::apply($application->fresh(), Status::APPLY_FOR_NIC, $staff);

        return $this->reread($application);
    }

    private function move(User $actor, CipPerson $person, string $status, array $extra = [])
    {
        return $this->actingAs($actor)
            ->postJson('/portal/cip/people/'.$person->uuid.'/status', ['status' => $status] + $extra);
    }

    /* ── the same lane, the same words ─────────────────────────────── */

    public function test_people_enter_post_approval_on_the_applications_own_step(): void
    {
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        $this->assertSame(Status::POST_APPROVAL, $application->status);

        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::POST_APPROVAL, $person->post_approval_status);
        }

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        // One vocabulary: the person's chip is the application's chip.
        $this->assertSame($body['status'], $body['applicant']['status']);
        $this->assertSame($body['statusLabel'], $body['applicant']['statusLabel']);
        $this->assertSame($body['statusTone'], $body['applicant']['statusTone']);
        $this->assertSame('Post-Approval', $body['dependents'][0]['statusLabel']);
    }

    /**
     * The report this fixes: a file at Approved whose main applicant still
     * read Not started.
     */
    public function test_people_are_approved_when_the_application_is(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application] = $this->family($staff);

        $this->approve($application, $staff);
        [$application, $main, $spouse, $child] = $this->reread($application);

        $this->assertSame(Status::POST_APPROVED, $application->status);

        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::POST_APPROVED, $person->post_approval_status);
        }

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame('Approved', $body['statusLabel']);
        $this->assertSame('Approved', $body['applicant']['statusLabel']);
        $this->assertSame(['Approved', 'Approved'], array_column($body['dependents'], 'statusLabel'));
    }

    public function test_a_row_that_was_never_settled_reads_as_the_applications_step(): void
    {
        $staff = $this->staff();
        [$application, $main] = $this->family($staff);

        // What the retired vocabulary left behind, and a row with nothing.
        $main->forceFill(['post_approval_status' => 'processing'])->saveQuietly();
        $main->setRelation('application', $application);

        $this->assertSame(PersonStatus::POST_APPROVAL, PersonStatus::current($main));

        // Opening the file settles it for good.
        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::POST_APPROVAL);

        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
        // An old audit row still says what it said on the day.
        $this->assertSame('Processing', PersonStatus::label('processing'));
    }

    public function test_family_members_in_listing_carry_person_status(): void
    {
        $staff = $this->staff();
        [$application] = $this->family($staff);

        $row = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase=post_approval')
            ->assertOk()
            ->json('applications.0');

        $this->assertCount(3, $row['familyMembers']);
        $this->assertSame(PersonStatus::POST_APPROVAL, $row['familyMembers'][0]['status']);
        $this->assertSame('Post-Approval', $row['familyMembers'][0]['statusLabel']);

        $offered = array_column(
            $this->actingAs($staff)->getJson('/portal/cip/applications?phase=post_approval')->json('personStatuses'),
            'value',
        );
        $this->assertSame(PersonStatus::ALL, $offered);
        $this->assertNotContains('not_started', $offered);
    }

    /** A file denied as it is filed is denied for everyone on it. */
    public function test_a_file_denied_on_arrival_denies_everyone_on_it(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        PostApproval::denyAtIntake($application->fresh(), $staff);

        foreach ([$main, $spouse, $child] as $person) {
            $fresh = $person->fresh();
            $this->assertSame(PersonStatus::POST_DENIED, $fresh->post_approval_status);
            // With the file, not apart from it: they follow it out again.
            $this->assertNull($fresh->post_approval_apart);
        }

        // An appeal takes the file somewhere this lane does not describe;
        // its people keep the status they last held.
        Engine::apply($application->fresh(), Status::NEW_APPEAL, $staff);
        $this->assertSame(PersonStatus::POST_DENIED, $main->fresh()->post_approval_status);
    }

    /* ── documents: the individual rule beside the main one ─────────── */

    public function test_a_person_reaches_apply_for_cor_on_their_own_documents(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);
        $this->approve($application, $staff);

        $this->ready($application, $main, $staff);

        [$application, $main, $spouse, $child] = $this->reread($application);

        // One person ready is that person at Apply for COR …
        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->post_approval_status);
        // … the others are where their own documents leave them …
        $this->assertSame(PersonStatus::POST_APPROVED, $spouse->post_approval_status);
        $this->assertSame(PersonStatus::POST_APPROVED, $child->post_approval_status);
        // … and the APPLICATION waits for all of them.
        $this->assertSame(Status::POST_APPROVED, $application->status);
        $this->assertFalse(Review::packageReady($application));

        $this->ready($application, $spouse, $staff);
        $this->assertSame(Status::POST_APPROVED, $application->fresh()->status);

        $this->ready($application, $child, $staff);

        [$application, $main, $spouse, $child] = $this->reread($application);

        $this->assertSame(Status::APPLY_FOR_COR, $application->status);
        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::APPLY_FOR_COR, $person->post_approval_status);
        }
    }

    public function test_a_document_sent_back_puts_only_its_owner_on_updates_required(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);
        $this->approve($application, $staff);

        $slot = $this->slots($application, $spouse, Pack::COR)->first();
        $this->file($spouse, $slot, $staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/request-changes', [
                'comment' => 'The notary stamp is not legible.',
            ])
            ->assertOk();

        [$application, $main, $spouse, $child] = $this->reread($application);

        $this->assertSame(Status::UPDATE_REQUIRED, $application->status);
        $this->assertSame(PersonStatus::UPDATE_REQUIRED, $spouse->post_approval_status);
        $this->assertSame(PersonStatus::POST_APPROVED, $main->post_approval_status);
        $this->assertSame(PersonStatus::POST_APPROVED, $child->post_approval_status);

        // Replaced: the spouse and the file are both collecting again, on
        // the label a decided file wears, and nobody is told it was
        // approved a second time.
        $approvals = fn () => Mail::queued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, ' APPROVED '))->count();
        $before = $approvals();

        $this->file($spouse->fresh(), $slot->fresh(), $staff);

        [$application, $main, $spouse] = $this->reread($application);

        $this->assertSame(Status::POST_APPROVED, $application->status);
        $this->assertSame(PersonStatus::POST_APPROVED, $spouse->post_approval_status);
        $this->assertSame($before, $approvals());
    }

    /* ── the application's dated steps carry everyone ───────────────── */

    public function test_everyone_moves_with_the_application_through_its_dated_steps(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->atApplyForNic($staff);

        $this->assertSame(Status::APPLY_FOR_NIC, $application->status);
        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::APPLY_FOR_NIC, $person->post_approval_status);
        }

        // The child is under 16 and owes no NIC papers; the adults do.
        $this->assertCount(0, $this->slots($application, $child, Pack::NIC, false));
        $this->ready($application, $main, $staff, Pack::NIC);
        $this->ready($application, $spouse, $staff, Pack::NIC);

        Stages::record($application->fresh(), $staff, Stages::NIC_SUBMITTED, Carbon::parse('2026-08-22'));
        foreach ($this->reread($application) as $i => $person) {
            if ($i > 0) {
                $this->assertSame(PersonStatus::PENDING_NIC, $person->post_approval_status);
            }
        }

        Stages::record($application->fresh(), $staff, Stages::NIC_RECEIVED, Carbon::parse('2026-08-23'));
        [$application, $main, $spouse, $child] = $this->reread($application);
        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::NIC_RECEIVED, $person->post_approval_status);
        }

        Engine::apply($application->fresh(), Status::APPLY_FOR_PASSPORT, $staff);
        [$application, $main, $spouse, $child] = $this->reread($application);
        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::APPLY_FOR_PASSPORT, $person->post_approval_status);
            $this->ready($application, $person, $staff, Pack::PASSPORT);
        }

        Stages::record($application->fresh(), $staff, Stages::PASSPORT_SUBMITTED, Carbon::parse('2026-08-24'));
        Stages::record($application->fresh(), $staff, Stages::PASSPORT_RECEIVED, Carbon::parse('2026-08-25'));
        Stages::record($application->fresh(), $staff, Stages::PASSPORT_DELIVERED, Carbon::parse('2026-08-26'));

        [$application, $main, $spouse, $child] = $this->reread($application);
        $this->assertSame(Status::PASSPORT_DELIVERED, $application->status);
        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::PASSPORT_DELIVERED, $person->post_approval_status);
        }
    }

    /* ── a step recorded for one person ─────────────────────────────── */

    public function test_a_persons_own_step_needs_their_documents_ready_for_submission(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        // Nothing filed yet: not offered on the file's own page …
        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->json('application');
        $this->assertNotContains(PersonStatus::PENDING_NIC, array_column($body['applicant']['availableStatuses'], 'value'));
        $this->assertContains(PersonStatus::PENDING_NIC, array_column($body['applicant']['lockedStatuses'], 'value'));

        // … and refused by name if it is asked for anyway.
        $refused = $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])
            ->assertStatus(422);
        $refusal = $refused->json('message');

        $this->assertStringContainsString('Not yet Ready for submission', $refusal);
        $this->assertStringContainsString('Completed R3 Form', $refusal);
        $this->assertSame(PersonStatus::APPLY_FOR_NIC, $main->fresh()->post_approval_status);

        // And as rows for the dialog that lists them: his documents alone,
        // though the spouse has filed nothing either.
        $rows = $refused->json('blockers');
        $this->assertContains('Completed R3 Form', array_column($rows, 'label'));
        $this->assertSame([$main->uuid], array_values(array_unique(array_column($rows, 'personId'))));
        $this->assertSame(['Pending upload'], array_values(array_unique(array_column($rows, 'statusLabel'))));

        // Filed but not yet read is still not ready.
        foreach ($this->slots($application, $main, Pack::NIC) as $slot) {
            $this->file($main, $slot, $staff);
        }
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertStatus(422);

        $this->ready($application, $main, $staff, Pack::NIC);

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->json('application');
        $next = collect($body['applicant']['availableStatuses'])->firstWhere('value', PersonStatus::PENDING_NIC);
        $this->assertNotNull($next);
        $this->assertSame(Stages::NIC_SUBMITTED, $next['stage']);
        $this->assertSame('NIC submission date', $next['dateLabel']);

        $moved = $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])
            ->assertOk()
            ->json('application');

        // The person moved; the family and the file did not.
        $this->assertSame(PersonStatus::PENDING_NIC, $moved['applicant']['status']);
        $this->assertSame('Pending NIC', $moved['applicant']['statusLabel']);
        $this->assertSame(Status::APPLY_FOR_NIC, $moved['status']);
        $this->assertSame(PersonStatus::APPLY_FOR_NIC, $spouse->fresh()->post_approval_status);
        $this->assertSame(['nic_submitted' => '2026-08-22'], $main->fresh()->post_approval_dates);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => PersonStatus::ACTION_CHANGED,
            'from_status' => PersonStatus::APPLY_FOR_NIC,
            'to_status' => PersonStatus::PENDING_NIC,
        ]);

        $lines = array_column(Timeline::for($application->fresh(), $staff), 'what');
        $this->assertContains(
            $staff->name.' moved ASEM HADDAD to Pending NIC on 2026-08-22',
            $lines,
        );
    }

    public function test_the_application_follows_once_every_person_has_moved_on(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->ready($application, $spouse, $staff, Pack::NIC);

        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();

        // The spouse is still on the file's step, so the file stays.
        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
        $this->assertNull($application->fresh()->nic_submitted_at);

        // The child is under 16 and is asked for no NIC papers: there is no
        // NIC step of her own to record, and she does not hold the file.
        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $childRow = collect($body['dependents'])->firstWhere('id', $child->uuid);
        $this->assertNotContains(PersonStatus::PENDING_NIC, array_column($childRow['availableStatuses'], 'value'));
        $this->move($staff, $child, PersonStatus::PENDING_NIC, ['date' => '2026-08-23'])->assertStatus(422);

        // The last person with NIC papers moves on, and the file goes too.
        $this->move($staff, $spouse, PersonStatus::PENDING_NIC, ['date' => '2026-08-24'])
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_NIC);

        $application = $application->fresh();
        $this->assertSame(Status::PENDING_NIC, $application->status);
        // On the last date recorded for anyone, and announced once.
        $this->assertSame('2026-08-24', $application->nic_submitted_at->toDateString());
        $this->assertSame(1, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_NIC_SUBMITTED)
            ->count());
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'PENDING NIC'));
        // And the child goes with it.
        $this->assertSame(PersonStatus::PENDING_NIC, $child->fresh()->post_approval_status);
    }

    public function test_a_person_ahead_of_the_file_gets_their_passport_slots_early(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();
        $this->move($staff, $main, PersonStatus::NIC_RECEIVED, ['date' => '2026-08-25'])->assertOk();
        $this->move($staff, $main, PersonStatus::APPLY_FOR_PASSPORT)
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::APPLY_FOR_PASSPORT)
            ->assertJsonPath('application.status', Status::APPLY_FOR_NIC);

        // Their own passport papers are on their checklist …
        $mainKeys = $main->fresh()->documents()->pluck('type')->all();
        $this->assertContains(PassportRequirements::EPP_FORM, $mainKeys);
        $this->assertContains(NicRequirements::R3_FORM, $mainKeys);
        // … and nobody else's, who are still on the NIC step with the file.
        $this->assertNotContains(PassportRequirements::EPP_FORM, $spouse->fresh()->documents()->pluck('type')->all());
        $this->assertFalse(Pack::hasReachedPassport($application->fresh()));
        $this->assertSame(Pack::NIC, Pack::current($application->fresh()));

        // The next step for them asks for the passport pack, by name.
        $refusal = $this->move($staff, $main, PersonStatus::PENDING_PASSPORT, ['date' => '2026-08-26'])
            ->assertStatus(422)
            ->json('message');
        $this->assertStringContainsString('Completed ePP Form', $refusal);

        // A passport paper of theirs sent back is theirs alone: the file is
        // still judged on the NIC pack it is collecting.
        $epp = $this->slots($application, $main->fresh(), Pack::PASSPORT)->firstWhere('type', PassportRequirements::EPP_FORM);
        $this->file($main->fresh(), $epp, $staff);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$epp->uuid.'/request-changes', ['comment' => 'Section 13 is not stamped.'])
            ->assertOk();

        $this->assertSame(PersonStatus::UPDATE_REQUIRED, $main->fresh()->post_approval_status);
        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
        $this->assertSame(PersonStatus::APPLY_FOR_NIC, $spouse->fresh()->post_approval_status);
    }

    public function test_the_cor_steps_are_the_applications_alone(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        foreach ([$main, $spouse, $child] as $person) {
            $this->ready($application, $person, $staff);
        }

        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->fresh()->post_approval_status);

        foreach ([PersonStatus::PENDING_COR, PersonStatus::APPLY_FOR_NIC] as $to) {
            $message = $this->move($staff, $main, $to, ['date' => '2026-08-20'])
                ->assertStatus(422)
                ->json('message');

            $this->assertStringContainsString('recorded on the application', $message);
        }

        // Nor can documents be skipped by typing the status they lead to.
        $this->move($staff, $spouse, PersonStatus::UPDATE_REQUIRED)->assertStatus(422);

        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->fresh()->post_approval_status);
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
    }

    public function test_apply_for_cor_cannot_be_typed_for_a_person_whose_documents_are_not_ready(): void
    {
        $staff = $this->staff();
        [, $main] = $this->family($staff);

        $message = $this->move($staff, $main, PersonStatus::APPLY_FOR_COR)
            ->assertStatus(422)
            ->json('message');

        $this->assertStringContainsString('Ready for submission', $message);
        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
    }

    /* ── an outcome of their own ────────────────────────────────────── */

    /**
     * One member of the family refused while the rest go through.
     *
     * Not the application's decision: no decision columns are written and
     * nothing is sent. And from then on that person's unfiled papers stop
     * holding everybody else's package.
     */
    public function test_a_person_denied_on_their_own_stops_holding_the_family(): void
    {
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        // Faked after the setup: entering post-approval sends the COR
        // notice, which is the application's business.
        Mail::fake();

        $body = $this->move($staff, $spouse, PersonStatus::POST_DENIED)
            ->assertOk()
            ->json('application');

        $denied = collect($body['dependents'])->firstWhere('id', $spouse->uuid);
        $this->assertSame(PersonStatus::POST_DENIED, $denied['status']);
        $this->assertSame('Denied', $denied['statusLabel']);
        $this->assertTrue($denied['statusApart']);

        $fresh = $application->fresh();
        $this->assertSame(Status::POST_APPROVAL, $fresh->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $fresh->decision);
        $this->assertNull($fresh->decision_letter_file_id);
        Mail::assertNothingQueued();
        Mail::assertNothingSent();

        // The rest of the family, ready: the file goes to Apply for COR
        // without the paper the denied spouse never filed.
        $this->ready($application, $main, $staff);
        $this->ready($application, $child, $staff);

        [$application, $main, $spouse, $child] = $this->reread($application);
        $this->assertSame(Status::APPLY_FOR_COR, $application->status);
        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->post_approval_status);
        // And they do not follow it.
        $this->assertSame(PersonStatus::POST_DENIED, $spouse->post_approval_status);

        // Their part of the file can be closed off.
        $this->move($staff, $spouse, PersonStatus::CLOSED)
            ->assertOk();
        $this->assertSame(PersonStatus::CLOSED, $spouse->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::APART_CLOSED, $spouse->fresh()->post_approval_apart);
    }

    /**
     * The other order: everybody else is ready first, and the hold-out is
     * denied afterwards.
     *
     * No document is left to judge by then, so no verdict would ever tell
     * the application its package is ready. The outcome itself has to, or
     * the file sits at Approved over a family that all reads Apply for COR.
     * Taking the outcome back is the same question the other way round.
     */
    public function test_denying_the_hold_out_moves_the_ready_family_on_and_taking_it_back_returns_them(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);
        $this->approve($application, $staff);

        $this->ready($application, $main, $staff);
        $this->ready($application, $child, $staff);
        $this->assertSame(Status::POST_APPROVED, $application->fresh()->status);

        $this->move($staff, $spouse, PersonStatus::POST_DENIED)
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPLY_FOR_COR)
            ->assertJsonPath('application.applicant.status', PersonStatus::APPLY_FOR_COR);

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'APPLY FOR COR'));

        // Back in step, with papers still owed: the unconfirmed file is no
        // longer ready, and says so.
        $this->move($staff, $spouse, PersonStatus::POST_APPROVED)
            ->assertOk()
            ->assertJsonPath('application.status', Status::POST_APPROVED);

        [$application, $main, $spouse] = $this->reread($application);
        $this->assertSame(Status::POST_APPROVED, $application->status);
        $this->assertSame(PersonStatus::POST_APPROVED, $spouse->post_approval_status);
        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->post_approval_status);
    }

    /**
     * Somebody who owes nothing has no documents to speak for them.
     *
     * A sponsor is on the file and is asked for no COR papers. "Every
     * document accepted" is true of none, and must not stand them at Apply
     * for COR ahead of a family that is still filing.
     */
    public function test_a_person_who_owes_nothing_wears_the_files_own_label(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        $sponsor = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_SPONSOR,
            'first_name' => 'Karim',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(66),
        ]);
        PostApproval::prepare($application->fresh(), $staff);

        $this->assertCount(0, $this->slots($application, $sponsor, Pack::COR, false));

        $this->ready($application, $main, $staff);
        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::POST_APPROVAL, $sponsor->fresh()->post_approval_status);

        $this->ready($application, $spouse, $staff);
        $this->ready($application, $child, $staff);

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        $this->assertSame(PersonStatus::APPLY_FOR_COR, $sponsor->fresh()->post_approval_status);
    }

    /**
     * Taken back, a person stands where their own documents put them, not
     * where somebody owing nothing would.
     */
    public function test_a_denied_person_comes_back_to_the_step_their_documents_support(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->family($staff);
        $this->approve($application, $staff);

        // Somebody else on the file has papers in, the spouse has none.
        $this->ready($application, $main, $staff);
        $this->move($staff, $spouse, PersonStatus::POST_DENIED)->assertOk();

        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $offered = collect($body['dependents'])->firstWhere('id', $spouse->uuid)['availableStatusOverrides'];
        $this->assertSame([PersonStatus::POST_APPROVED], array_column($offered, 'value'));

        // The same answer on a table row, which has not loaded the checklist.
        $row = $this->actingAs($staff)->getJson('/portal/cip/applications?phase=post_approval')->json('applications.0');
        $member = collect($row['familyMembers'])->firstWhere('id', $spouse->uuid);
        $this->assertSame([PersonStatus::POST_APPROVED], array_column($member['availableStatusOverrides'], 'value'));

        $this->move($staff, $spouse, PersonStatus::POST_APPROVED)
            ->assertOk();

        $this->assertSame(PersonStatus::POST_APPROVED, $spouse->fresh()->post_approval_status);
        $this->assertNull($spouse->fresh()->post_approval_apart);
    }

    public function test_a_person_can_be_pulled_back_into_step_with_the_file(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        // An outcome taken back: they stand where the file stands again.
        $this->move($staff, $spouse, PersonStatus::POST_DENIED)->assertOk();

        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $offered = collect($body['dependents'])->firstWhere('id', $spouse->uuid)['availableStatusOverrides'];
        $this->assertSame([PersonStatus::APPLY_FOR_NIC], array_column($offered, 'value'));

        $this->move($staff, $spouse, PersonStatus::APPLY_FOR_NIC)->assertOk();
        $this->assertNull($spouse->fresh()->post_approval_apart);
        $this->assertSame(PersonStatus::APPLY_FOR_NIC, $spouse->fresh()->post_approval_status);

        // A step recorded for them alone, taken back.
        $this->ready($application, $main, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();
        $this->move($staff, $main, PersonStatus::NIC_RECEIVED, ['date' => '2026-08-25'])->assertOk();
        $this->move($staff, $main, PersonStatus::APPLY_FOR_PASSPORT)->assertOk();

        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $this->assertSame(
            [PersonStatus::APPLY_FOR_NIC, PersonStatus::PENDING_NIC, PersonStatus::NIC_RECEIVED],
            array_column($body['applicant']['availableStatusOverrides'], 'value'),
        );

        $this->move($staff, $main, PersonStatus::PENDING_NIC)
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::PENDING_NIC);

        $this->assertSame(['nic_submitted' => '2026-08-22'], $main->fresh()->post_approval_dates);

        $lines = array_column(Timeline::for($application->fresh(), $staff), 'what');
        $this->assertContains($staff->name.' pulled ASEM HADDAD back to Pending NIC', $lines);

        // But never below where the application itself stands.
        $this->move($staff, $main, PersonStatus::APPLY_FOR_COR)->assertStatus(422);
    }

    /**
     * A person who went ahead on their own still answers for a paper of
     * theirs sent back in the pack the file is collecting.
     */
    public function test_a_person_ahead_reads_updates_required_when_their_paper_is_sent_back(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();

        $r3 = $this->slots($application, $main, Pack::NIC)->firstWhere('type', NicRequirements::R3_FORM);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$r3->uuid.'/request-changes', ['comment' => 'The witness has not signed.'])
            ->assertOk();

        // The file is Updates Required, and so is the person whose paper it was.
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->assertSame(PersonStatus::UPDATE_REQUIRED, $main->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::APPLY_FOR_NIC, $spouse->fresh()->post_approval_status);

        // NIC received is not theirs to record while that stands.
        $this->move($staff, $main, PersonStatus::NIC_RECEIVED, ['date' => '2026-08-25'])->assertStatus(422);

        // Replaced and accepted: back where their own date had put them.
        $this->file($main->fresh(), $r3->fresh(), $staff);
        $this->actingAs($staff)->postJson('/portal/cip/documents/'.$r3->uuid.'/approve')->assertOk();

        $this->assertSame(PersonStatus::PENDING_NIC, $main->fresh()->post_approval_status);
        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
    }

    /** Somebody's part of the file finished or withdrawn, with no refusal. */
    public function test_a_person_can_be_closed_on_their_own_without_being_denied(): void
    {
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->family($staff);

        $this->move($staff, $spouse, PersonStatus::CLOSED)
            ->assertOk();

        $spouse = $spouse->fresh();
        $this->assertSame(PersonStatus::CLOSED, $spouse->post_approval_status);
        $this->assertSame(PersonStatus::APART_CLOSED, $spouse->post_approval_apart);
        // The file is not closed by it, and nobody else is.
        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);
        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
    }

    /**
     * The last person still on the file's step is set apart: everybody who
     * is left has already moved on, so the file goes after them.
     */
    public function test_setting_the_last_straggler_apart_lets_the_file_follow_the_rest(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();
        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);

        $this->move($staff, $spouse, PersonStatus::POST_DENIED)
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_NIC);

        $this->assertSame('2026-08-22', $application->fresh()->nic_submitted_at->toDateString());
    }

    /**
     * Denied, the family's package confirmed without them, and then the
     * denial taken back: the one way a person could ride past the COR step
     * on documents nobody accepted. There is no way back into a confirmed
     * package for somebody whose own papers were not in it.
     */
    public function test_a_person_set_apart_cannot_rejoin_a_package_confirmed_without_their_documents(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        $this->move($staff, $spouse, PersonStatus::POST_DENIED)->assertOk();
        $this->ready($application, $main, $staff);
        $this->ready($application, $child, $staff);
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);

        // Before the package is confirmed she may still be taken back.
        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $this->assertNotEmpty(collect($body['dependents'])->firstWhere('id', $spouse->uuid)['availableStatusOverrides']);

        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));
        Stages::record($application->fresh(), $staff, Stages::COR_SUBMITTED, Carbon::parse('2026-08-20'));

        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $this->assertSame([], collect($body['dependents'])->firstWhere('id', $spouse->uuid)['availableStatusOverrides']);

        $message = $this->move($staff, $spouse, PersonStatus::PENDING_COR)
            ->assertStatus(422)
            ->json('message');

        $this->assertStringContainsString('cannot rejoin this application', $message);
        $this->assertSame(PersonStatus::POST_DENIED, $spouse->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::PENDING_COR, $main->fresh()->post_approval_status);
    }

    /**
     * The same door one pack later. Set apart at Apply for NIC with nothing
     * filed, the family's NIC goes in without her, and she cannot then be
     * put back on Pending NIC with an R3 form nobody ever saw.
     */
    public function test_a_person_set_apart_cannot_rejoin_after_the_nic_went_in_without_their_documents(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();
        $this->move($staff, $spouse, PersonStatus::POST_DENIED)
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_NIC);

        $this->assertSame(Pack::NIC, $spouse->fresh()->post_approval_missed);

        $body = $this->actingAs($staff)->getJson('/portal/cip/applications/'.$application->uuid)->json('application');
        $this->assertSame([], collect($body['dependents'])->firstWhere('id', $spouse->uuid)['availableStatusOverrides']);

        $this->move($staff, $spouse, PersonStatus::PENDING_NIC)
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'AMIRA HADDAD cannot rejoin this application; it has moved on without their documents.']);
        $this->assertSame(PersonStatus::POST_DENIED, $spouse->fresh()->post_approval_status);
    }

    /**
     * Only somebody apart AT the hand-over missed it. An outcome pressed by
     * mistake on a person who was in the package can be taken straight back,
     * though the confirmed package has frozen their slots since.
     */
    public function test_an_outcome_set_after_the_package_went_can_still_be_taken_back(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        foreach ([$main, $spouse, $child] as $person) {
            $this->ready($application, $person, $staff);
        }
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));
        Stages::record($application->fresh(), $staff, Stages::COR_SUBMITTED, Carbon::parse('2026-08-20'));

        $this->move($staff, $spouse, PersonStatus::CLOSED)->assertOk();
        $this->assertNull($spouse->fresh()->post_approval_missed);

        $this->move($staff, $spouse, PersonStatus::PENDING_COR)
            ->assertOk();
        $this->assertSame(PersonStatus::PENDING_COR, $spouse->fresh()->post_approval_status);
        $this->assertNull($spouse->fresh()->post_approval_apart);
    }

    /**
     * A lift refused on the day is made when what refused it clears.
     *
     * The last person with NIC papers is recorded while somebody else has
     * an optional paper still unread: the application's own gate says no,
     * rightly, and the person's step stands. Once that paper is accepted
     * nothing is left to hold the file, and it goes after its people.
     */
    public function test_the_application_follows_its_people_once_what_held_it_back_clears(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->ready($application, $spouse, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();

        // An optional NIC paper of his arrives and is not yet read.
        $optional = $this->slots($application, $main, Pack::NIC, false)->firstWhere('required', false);
        $this->assertNotNull($optional);
        $this->file($main->fresh(), $optional, $staff);

        $this->move($staff, $spouse, PersonStatus::PENDING_NIC, ['date' => '2026-08-24'])->assertOk();
        $this->assertSame(PersonStatus::PENDING_NIC, $spouse->fresh()->post_approval_status);
        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);

        $this->actingAs($staff)->postJson('/portal/cip/documents/'.$optional->uuid.'/approve')->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::PENDING_NIC, $fresh->status);
        $this->assertSame('2026-08-24', $fresh->nic_submitted_at->toDateString());
        // The file following is the system's, not whoever accepted the paper.
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_NIC_SUBMITTED,
            'actor_id' => null,
        ]);
    }

    /**
     * The other thing that refuses a lift: the file standing on Updates
     * Required when the last person is recorded. It has no step of its own
     * there, and takes it once the paper is put right.
     */
    public function test_the_application_follows_its_people_after_coming_off_updates_required(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->ready($application, $spouse, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();

        $r3 = $this->slots($application, $main, Pack::NIC)->firstWhere('type', NicRequirements::R3_FORM);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$r3->uuid.'/request-changes', ['comment' => 'The witness has not signed.'])
            ->assertOk();
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        // The spouse has nothing wrong and can still be recorded.
        $this->move($staff, $spouse, PersonStatus::PENDING_NIC, ['date' => '2026-08-24'])->assertOk();
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        $this->file($main->fresh(), $r3->fresh(), $staff);
        $this->actingAs($staff)->postJson('/portal/cip/documents/'.$r3->uuid.'/approve')->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::PENDING_NIC, $fresh->status);
        $this->assertSame('2026-08-24', $fresh->nic_submitted_at->toDateString());
        $this->assertSame(PersonStatus::PENDING_NIC, $main->fresh()->post_approval_status);
    }

    /**
     * A page of records for the offline copy is built the way a table row
     * is: each person's next step offered, their documents not counted.
     */
    public function test_the_offline_sync_carries_each_persons_status_without_counting_documents(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main] = $this->atApplyForNic($staff);

        $record = collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications/sync')
            ->assertOk()
            ->json('applications'))->firstWhere('id', $application->uuid);

        $this->assertNotNull($record);
        $this->assertSame(PersonStatus::APPLY_FOR_NIC, $record['applicant']['status']);
        $this->assertSame('Apply for NIC', $record['applicant']['statusLabel']);
        // Offered here although nothing is filed; the write is what judges.
        $this->assertContains(PersonStatus::PENDING_NIC, array_column($record['applicant']['availableStatuses'], 'value'));
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertStatus(422);
    }

    /**
     * A passport paper sent back while the family was still on its NIC is
     * the file's business the moment the file reaches the passport step.
     */
    public function test_a_file_arriving_at_a_collecting_step_reads_what_is_already_waiting_there(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->ready($application, $spouse, $staff, Pack::NIC);
        $this->move($staff, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])->assertOk();
        $this->move($staff, $main, PersonStatus::NIC_RECEIVED, ['date' => '2026-08-25'])->assertOk();
        $this->move($staff, $main, PersonStatus::APPLY_FOR_PASSPORT)->assertOk();

        $epp = $this->slots($application, $main->fresh(), Pack::PASSPORT)->firstWhere('type', PassportRequirements::EPP_FORM);
        $this->file($main->fresh(), $epp, $staff);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$epp->uuid.'/request-changes', ['comment' => 'Section 13 is not stamped.'])
            ->assertOk();
        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);

        // The rest of the family catches up through the application's own dates.
        Stages::record($application->fresh(), $staff, Stages::NIC_SUBMITTED, Carbon::parse('2026-08-26'));
        Stages::record($application->fresh(), $staff, Stages::NIC_RECEIVED, Carbon::parse('2026-08-28'));
        Engine::apply($application->fresh(), Status::APPLY_FOR_PASSPORT, $staff);

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->assertSame(PersonStatus::UPDATE_REQUIRED, $main->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::APPLY_FOR_PASSPORT, $spouse->fresh()->post_approval_status);
    }

    /** Every passport step for one person, with the file following the last of them. */
    public function test_a_persons_passport_steps_run_to_closed_and_the_file_closes_after_everyone(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->atApplyForNic($staff);

        $this->ready($application, $main, $staff, Pack::NIC);
        $this->ready($application, $spouse, $staff, Pack::NIC);
        Stages::record($application->fresh(), $staff, Stages::NIC_SUBMITTED, Carbon::parse('2026-08-22'));
        Stages::record($application->fresh(), $staff, Stages::NIC_RECEIVED, Carbon::parse('2026-08-23'));
        Engine::apply($application->fresh(), Status::APPLY_FOR_PASSPORT, $staff);

        [$application, $main, $spouse, $child] = $this->reread($application);
        $people = [$main, $spouse, $child];

        foreach ($people as $person) {
            $this->ready($application, $person, $staff, Pack::PASSPORT);
        }

        $walk = [
            PersonStatus::PENDING_PASSPORT => '2026-09-01',
            PersonStatus::PASSPORT_RECEIVED => '2026-09-10',
            PersonStatus::PASSPORT_DELIVERED => '2026-09-12',
        ];

        // The first two all the way; the file stays for the third.
        foreach ([$main, $spouse] as $person) {
            foreach ($walk as $to => $date) {
                $this->move($staff, $person, $to, ['date' => $date])->assertOk();
            }
            $this->assertSame(PersonStatus::PASSPORT_DELIVERED, $person->fresh()->post_approval_status);
            // Closed by a delivery date, not set apart.
            $this->assertNull($person->fresh()->post_approval_apart);
        }
        $this->assertSame(Status::APPLY_FOR_PASSPORT, $application->fresh()->status);

        foreach ($walk as $to => $date) {
            $this->move($staff, $child, $to, ['date' => '2026-09-2'.substr($date, -1)])->assertOk();
        }

        $fresh = $application->fresh();
        $this->assertSame(Status::PASSPORT_DELIVERED, $fresh->status);
        $this->assertSame('2026-09-21', $fresh->passport_submitted_at->toDateString());
        $this->assertSame('2026-09-22', $fresh->passport_delivered_at->toDateString());
    }

    /**
     * The checklist changes with no document judged: a dependant is added
     * on Edit application while the file stands on an unconfirmed Apply for
     * COR. It can no longer say every document is ready, and does not.
     */
    public function test_an_unconfirmed_apply_for_cor_steps_back_when_somebody_new_owes_documents(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        foreach ([$main, $spouse, $child] as $person) {
            $this->ready($application, $person, $staff);
        }
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
            'first_name' => 'Sami',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(19),
        ]);

        // Opening the file is enough: that is when the new checklist appears.
        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::POST_APPROVAL, $body['status']);
        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);
        // The three who are ready still say so; the newcomer is collecting.
        $this->assertSame(PersonStatus::APPLY_FOR_COR, $main->fresh()->post_approval_status);
        $sami = CipPerson::query()->where('first_name', 'SAMI')->first();
        $this->assertSame(PersonStatus::POST_APPROVAL, $sami->post_approval_status);
    }

    /* ── the lane's decision and the label a file collects under ─────── */

    /**
     * Undoing the lane's decision takes the decision with it.
     *
     * A file pulled from Approved back to Post-Approval used to keep the
     * approval on its row, so its people went on reading Approved under a
     * chip that said Post-Approval, and the next paper sent back and
     * replaced walked the file to Approved again with nobody having decided
     * anything.
     */
    public function test_pulling_an_approved_file_back_to_post_approval_undoes_the_decision(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse] = $this->family($staff);
        // The Unit's grant, on the trail the way the decision verb leaves it.
        Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $staff, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-07-14',
        ]);
        $this->approve($application, $staff);
        $this->assertSame(Status::POST_APPROVED, $application->fresh()->decision);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::POST_APPROVAL,
                'note' => 'The approval was recorded on the wrong file.',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::POST_APPROVAL);

        // Everybody reads what the file reads again …
        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::POST_APPROVAL, $spouse->fresh()->post_approval_status);
        // … and the lane's approval is off the row, with the trail saying
        // so: what stands there again is the grant it held before.
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame('2026-07-14', $application->fresh()->decided_at->toDateString());
        $undo = CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::POST_APPROVAL)
            ->orderByDesc('id')
            ->first();
        $this->assertSame(Status::POST_APPROVED, $undo->meta['clearedDecision'] ?? null);

        // A paper sent back and replaced brings it back to Post-Approval.
        $slot = $this->slots($application, $spouse, Pack::COR)->first();
        $this->file($spouse, $slot, $staff);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/request-changes', ['comment' => 'Not legible.'])
            ->assertOk();
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->file($spouse->fresh(), $slot->fresh(), $staff);

        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);
        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
    }

    public function test_a_decided_file_on_updates_required_is_not_offered_post_approval_as_its_next_step(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, , $spouse] = $this->family($staff);
        $this->approve($application, $staff);

        $slot = $this->slots($application, $spouse, Pack::COR)->first();
        $this->file($spouse, $slot, $staff);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/request-changes', ['comment' => 'Not legible.'])
            ->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::UPDATE_REQUIRED, $fresh->status);
        $this->assertNotContains(Status::POST_APPROVAL, Engine::availableTransitions($fresh, $staff));

        // An undecided one still is: Post-Approval is its collecting label.
        [$undecided, , $other] = $this->family($staff);
        $slot = $this->slots($undecided, $other, Pack::COR)->first();
        $this->file($other, $slot, $staff);
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/request-changes', ['comment' => 'Not legible.'])
            ->assertOk();
        $this->assertContains(Status::POST_APPROVAL, Engine::availableTransitions($undecided->fresh(), $staff));
    }

    /* ── the day the rules arrive ───────────────────────────────────── */

    /**
     * A decided file the old rules left wearing Post-Approval.
     *
     * They knew one collecting label, so an approved file that had a paper
     * sent back and replaced came back looking undecided. The pass puts it
     * on Approved again, quietly. One a person pulled back by hand was the
     * decision being undone, and there it is the decision that goes.
     */
    public function test_the_settle_pass_relabels_a_decided_file_left_looking_undecided(): void
    {
        Mail::fake();
        $staff = $this->staff();

        [$returned] = $this->family($staff);
        $this->approve($returned, $staff);
        $returned->fresh()->forceFill(['status' => Status::POST_APPROVAL])->saveQuietly();
        Engine::record($returned, CipEvent::ACTION_STATUS_CHANGED, null, ['reason' => 'checklist', 'override' => true], Status::UPDATE_REQUIRED, Status::POST_APPROVAL);

        [$undone] = $this->family($staff);
        $this->approve($undone, $staff);
        $undone->fresh()->forceFill(['status' => Status::POST_APPROVAL])->saveQuietly();
        Engine::record($undone, CipEvent::ACTION_STATUS_CHANGED, $staff, ['override' => true, 'note' => 'Wrong file.'], Status::POST_APPROVED, Status::POST_APPROVAL);

        // And one an officer walked back from Updates Required with the
        // step the old picker offered for it. By hand, but nobody undid
        // anything: Post-Approval was simply the only collecting label.
        [$stepped] = $this->family($staff);
        $this->approve($stepped, $staff);
        $stepped->fresh()->forceFill(['status' => Status::POST_APPROVAL])->saveQuietly();
        Engine::record($stepped, CipEvent::ACTION_STATUS_CHANGED, $staff, [], Status::UPDATE_REQUIRED, Status::POST_APPROVAL);

        Mail::fake();
        $this->artisan('cip:settle-people')->assertSuccessful();

        $this->assertSame(Status::POST_APPROVED, $stepped->fresh()->status);
        $this->assertSame(Status::POST_APPROVED, $stepped->fresh()->decision);

        $this->assertSame(Status::POST_APPROVED, $returned->fresh()->status);
        $this->assertSame(Status::POST_APPROVED, $returned->fresh()->decision);
        $this->assertSame(
            [PersonStatus::POST_APPROVED],
            CipPerson::query()->where('application_id', $returned->id)->pluck('post_approval_status')->unique()->values()->all(),
        );

        $this->assertSame(Status::POST_APPROVAL, $undone->fresh()->status);
        $this->assertNotSame(Status::POST_APPROVED, $undone->fresh()->decision);
        $this->assertSame(
            [PersonStatus::POST_APPROVAL],
            CipPerson::query()->where('application_id', $undone->id)->pluck('post_approval_status')->unique()->values()->all(),
        );

        // Nothing was decided today, so nobody is told anything.
        Mail::assertNothingQueued();
    }


    /**
     * What the deploy finds: a file the old rules left standing at Approved
     * with every paper already accepted, and people on the old vocabulary.
     *
     * Nothing is left to judge on it, so nothing would ever move it. The
     * one pass that settles people also walks that file, and the provider
     * is told to confirm, as on the day it should have happened.
     */
    public function test_the_settle_pass_moves_a_file_left_stranded_at_approved(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        foreach ([$main, $spouse, $child] as $person) {
            $this->ready($application, $person, $staff);
        }

        // Put back the way the old code left it: at Approved, deaf to the
        // accepted checklist, everybody on a status nothing ever moved.
        $application->fresh()->forceFill([
            'status' => Status::POST_APPROVED,
            'decision' => Status::POST_APPROVED,
        ])->saveQuietly();
        CipPerson::query()->where('application_id', $application->id)->update(['post_approval_status' => null]);

        // A second file somebody set to Updates Required by hand, with no
        // paper sent back, and a third already closed.
        [$manual] = $this->family($staff);
        Engine::apply($manual->fresh(), Status::UPDATE_REQUIRED, $staff);
        [$closed] = $this->family($staff);
        $closed->forceFill(['status' => Status::CLOSED, 'updated_at' => '2026-01-05 10:00:00'])->saveQuietly();
        CipPerson::query()->where('application_id', $closed->id)->update(['post_approval_status' => null]);

        Mail::fake();

        $this->artisan('cip:settle-people')->assertSuccessful();

        [$application, $main, $spouse, $child] = $this->reread($application);
        $this->assertSame(Status::APPLY_FOR_COR, $application->status);
        foreach ([$main, $spouse, $child] as $person) {
            $this->assertSame(PersonStatus::APPLY_FOR_COR, $person->post_approval_status);
        }
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'APPLY FOR COR')
            && str_contains((string) $mail->subjectLine, $application->displayNumber()));

        // A status somebody chose is not second-guessed by the pass …
        $this->assertSame(Status::UPDATE_REQUIRED, $manual->fresh()->status);
        // … and a finished file gets its people's status without being
        // stamped as changed today.
        $this->assertSame(Status::CLOSED, $closed->fresh()->status);
        $this->assertSame('2026-01-05', $closed->fresh()->updated_at->toDateString());
        $this->assertSame(
            [PersonStatus::CLOSED],
            CipPerson::query()->where('application_id', $closed->id)->pluck('post_approval_status')->unique()->values()->all(),
        );

        // Nothing left to do the second time.
        Mail::fake();
        $this->artisan('cip:settle-people')->assertSuccessful();
        Mail::assertNothingQueued();
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
    }

    /**
     * The schema migration's own three updates, and its way back.
     *
     * Run against rows as the release before left them: an outcome somebody
     * chose by hand is kept as that person standing apart, everything else
     * is cleared for the settle pass. Rolled back, the two outcomes are
     * handed back in the words the old release reads.
     */
    public function test_the_migration_keeps_hand_set_outcomes_and_hands_them_back_on_rollback(): void
    {
        $staff = $this->staff();
        [$application, $main, $spouse, $child] = $this->family($staff);

        $migration = require database_path('migrations/2026_10_10_230000_put_cip_people_on_the_post_approval_lane.php');
        $migration->down();

        \Illuminate\Support\Facades\DB::table('cip_people')->where('id', $main->id)->update(['post_approval_status' => 'processing']);
        \Illuminate\Support\Facades\DB::table('cip_people')->where('id', $spouse->id)->update(['post_approval_status' => 'denied']);
        \Illuminate\Support\Facades\DB::table('cip_people')->where('id', $child->id)->update(['post_approval_status' => 'closed']);

        $migration->up();

        $row = fn (CipPerson $person) => (array) \Illuminate\Support\Facades\DB::table('cip_people')
            ->where('id', $person->id)
            ->first(['post_approval_status', 'post_approval_apart']);

        $this->assertSame(['post_approval_status' => null, 'post_approval_apart' => null], $row($main));
        $this->assertSame(['post_approval_status' => 'post_denied', 'post_approval_apart' => 'denied'], $row($spouse));
        $this->assertSame(['post_approval_status' => 'closed', 'post_approval_apart' => 'closed'], $row($child));

        // The settle pass then gives the cleared row its step.
        $this->artisan('cip:settle-people')->assertSuccessful();
        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
        $this->assertSame(PersonStatus::POST_DENIED, $spouse->fresh()->post_approval_status);

        $migration->down();

        $old = \Illuminate\Support\Facades\DB::table('cip_people')
            ->whereIn('id', [$main->id, $spouse->id, $child->id])
            ->orderBy('id')
            ->pluck('post_approval_status', 'id')
            ->all();
        $this->assertSame([$main->id => null, $spouse->id => 'denied', $child->id => 'closed'], $old);
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('cip_people', 'post_approval_apart'));

        // Leave the schema as every other test expects to find it.
        $migration->up();
    }

    /**
     * An audit row from before the lane still reads as what happened.
     *
     * The old vocabulary marked every move off its map an override, a jump
     * forward included. Only a move this code marked is a pull-back.
     */
    public function test_an_old_audit_row_is_not_reworded_as_a_pull_back(): void
    {
        $staff = $this->staff();
        [$application, $main] = $this->family($staff);

        Engine::record($application, PersonStatus::ACTION_CHANGED, $staff, [
            'person_id' => $main->uuid,
            'person_name' => $main->fullName(),
            'override' => true,
        ], 'not_started', 'processing');

        $lines = array_column(Timeline::for($application->fresh(), $staff), 'what');

        $this->assertContains($staff->name.' moved ASEM HADDAD to Processing', $lines);
    }

    /* ── who may, and when ──────────────────────────────────────────── */

    public function test_person_status_cannot_be_changed_before_post_approval(): void
    {
        $staff = $this->staff();
        $application = Applications::create($this->provider(), $staff);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        $this->move($staff, $person, PersonStatus::POST_DENIED)->assertStatus(422);
    }

    public function test_the_provider_side_reads_a_persons_status_and_cannot_move_it(): void
    {
        $staff = $this->staff();
        [$application, $main] = $this->family($staff);
        $contact = $this->contactOn($application, $staff);

        $body = $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame('Post-Approval', $body['applicant']['statusLabel']);
        $this->assertSame([], $body['applicant']['availableStatuses']);
        $this->assertSame([], $body['applicant']['availableStatusOverrides']);
        $this->assertSame([], $body['applicant']['lockedStatuses']);

        $this->move($contact, $main, PersonStatus::POST_DENIED)->assertForbidden();
        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
    }

    /**
     * Statuses are an administrator's or a CRO / Reviewing officer's to
     * change. Nobody on the provider side moves a person, whatever they may
     * do at their own firm, and neither does a login with no part in the file.
     */
    public function test_nobody_outside_the_firm_can_move_a_person(): void
    {
        $staff = $this->staff();
        [$application, $main] = $this->family($staff);

        $providerAdmin = $this->staff(Role::SERVICE_PROVIDER_ADMIN);
        CompanyMember::create([
            'company_id' => $application->provider->company_id,
            'user_id' => $providerAdmin->id,
            'name' => $providerAdmin->name,
            'email' => $providerAdmin->email,
            'role' => 'admin',
            'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        $this->move($providerAdmin, $main, PersonStatus::POST_DENIED)->assertForbidden();
        $this->move($this->staff(Role::CLIENT), $main, PersonStatus::CLOSED)->assertForbidden();

        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
        $this->assertNull($main->fresh()->post_approval_apart);
    }

    public function test_a_reviewing_officer_records_a_persons_step_and_may_take_it_back(): void
    {
        Mail::fake();
        $admin = $this->staff();
        $officer = $this->staff(Role::REVIEWING_OFFICER);
        [$application, $main] = $this->atApplyForNic($admin);
        \App\Support\Cip\Assignments::assign($application->fresh(), $officer, $admin);

        $this->ready($application, $main, $admin, Pack::NIC);

        $this->move($officer, $main, PersonStatus::PENDING_NIC, ['date' => '2026-08-22'])
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::PENDING_NIC);

        $this->move($officer, $main, PersonStatus::APPLY_FOR_NIC)
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::APPLY_FOR_NIC);

        $this->assertNull($main->fresh()->post_approval_dates);
    }

    /* ── the optional file that rides with a move ───────────────────── */

    public function test_a_person_status_change_can_file_an_optional_document_in_that_persons_folder(): void
    {
        $staff = $this->staff();
        [, $main, $spouse] = $this->family($staff);

        $this->actingAs($staff)->post('/portal/cip/people/'.$spouse->uuid.'/status', [
            'status' => PersonStatus::POST_DENIED,
            'attachment' => UploadedFile::fake()->createWithContent('refusal.pdf', '%PDF-1.4 refusal'),
        ], [
            'Accept' => 'application/json',
            'X-Requested-With' => 'XMLHttpRequest',
        ])->assertOk();

        $spouse = $spouse->fresh();
        $file = FileItem::query()->where('name', 'refusal.pdf')->first();

        $this->assertNotNull($file);
        $this->assertSame($spouse->post_approval_folder_id, $file->folder_id);
        $this->assertNotSame($main->fresh()->post_approval_folder_id, $file->folder_id);
        $this->assertSame(PersonStatus::POST_DENIED, $spouse->post_approval_status);
    }

    public function test_a_bad_status_file_does_not_move_the_person(): void
    {
        $staff = $this->staff();
        [, $main] = $this->family($staff);

        $this->actingAs($staff)->post('/portal/cip/people/'.$main->uuid.'/status', [
            'status' => PersonStatus::POST_DENIED,
            'attachment' => UploadedFile::fake()->create('notes.docx', 20, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        ], [
            'Accept' => 'application/json',
            'X-Requested-With' => 'XMLHttpRequest',
        ])->assertStatus(422);

        $this->assertSame(PersonStatus::POST_APPROVAL, $main->fresh()->post_approval_status);
        $this->assertNull($main->fresh()->post_approval_apart);
        $this->assertSame(0, FileItem::query()->where('name', 'notes.docx')->count());
    }
}
