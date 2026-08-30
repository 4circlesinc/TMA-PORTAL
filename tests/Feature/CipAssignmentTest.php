<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyStaffAssignment;
use App\Models\EmailDelivery;
use App\Models\User;
use App\Support\Access\CompanyScope;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * §10 — the administrator hands an application to an officer, and that is what
 * starts the review. §26 — they may hand it to somebody else at any time,
 * which must not drag a file that has moved on back to the beginning.
 *
 * The invariant behind all of it: cip_application_assignments is the
 * authority, and cip_applications.assigned_officer_id only ever says the same
 * thing as the live row.
 */
class CipAssignmentTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The module ships dark behind FEATURE_CIP, and every cip.* capability
        // is denied — administrators included — while it is off.
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

    /** An application at NEW: filed, waiting for an officer. */
    private function application(User $creator): CipApplication
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $creator);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application;
    }

    /** An application with a client, which is what §8's column actually reads. */
    private function filed(User $creator): CipApplication
    {
        $application = $this->application($creator);
        $client = Client::create([
            'uid' => 'chen-wei-'.$application->id,
            'name' => 'Chen Wei',
            'email' => 'chen@example.com',
            'created_by' => $creator->id,
            'data' => [],
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        return $application->refresh();
    }

    private function assign(User $actor, CipApplication $application, User $officer): TestResponse
    {
        return $this->actingAs($actor)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', ['userId' => $officer->id]);
    }

    public function test_assigning_a_new_application_starts_the_review(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $application = $this->application($admin);

        $this->assign($admin, $application, $officer)
            ->assertCreated()
            ->assertJsonPath('assignments.0.userId', $officer->id)
            ->assertJsonPath('assignments.0.role', 'reviewing_officer');

        $fresh = $application->fresh();
        $this->assertSame(Status::REVIEW_APPLICATION, $fresh->status, '§10: assignment is what starts the review');
        $this->assertSame($officer->id, $fresh->assigned_officer_id);

        $this->assertDatabaseHas('cip_application_assignments', [
            'application_id' => $application->id,
            'user_id' => $officer->id,
            'role' => 'reviewing_officer',
            'status' => CipApplicationAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);

        // Both halves are on the record: who was given it, and the move it
        // caused — with the administrator named as the actor of each.
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id, 'action' => 'assigned', 'actor_id' => $admin->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id, 'action' => 'status_changed',
            'from_status' => Status::NEW, 'to_status' => Status::REVIEW_APPLICATION,
        ]);
    }

    public function test_reassigning_later_changes_hands_without_moving_the_status(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $sam = $this->user(Role::REVIEWING_OFFICER, 'sam@example.com', 'Sam Reviewer');
        $application = $this->application($admin);

        $this->assign($admin, $application, $rita)->assertCreated();

        // Rita works it on, so the file is past the point assignment moves it.
        Engine::apply($application->fresh(), Status::ASSESSMENT_FEEDBACK, $rita);

        $this->assign($admin, $application, $sam)
            ->assertCreated()
            ->assertJsonCount(1, 'assignments')
            ->assertJsonPath('assignments.0.userId', $sam->id);

        $fresh = $application->fresh();
        $this->assertSame(Status::ASSESSMENT_FEEDBACK, $fresh->status, '§26: a change of hands is not a reset');
        $this->assertSame($sam->id, $fresh->assigned_officer_id);

        // Rita's row is ended, not deleted — the file keeps everybody who held
        // it, which is the point of ending rather than removing.
        $this->assertDatabaseHas('cip_application_assignments', [
            'application_id' => $application->id,
            'user_id' => $rita->id,
            'status' => CipApplicationAssignment::STATUS_ENDED,
            'ended_by' => $admin->id,
        ]);
    }

    public function test_the_cache_column_follows_the_live_assignment(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $sam = $this->user(Role::REVIEWING_OFFICER, 'sam@example.com', 'Sam Reviewer');
        $application = $this->application($admin);

        $this->assertNull($application->assigned_officer_id, 'nobody holds it yet');

        Assignments::assign($application, $rita, $admin);
        $this->assertSame($rita->id, $application->fresh()->assigned_officer_id);
        $this->assertSame($rita->id, Assignments::live($application)->first()->user_id);

        Assignments::assign($application->fresh(), $sam, $admin);
        $this->assertSame($sam->id, $application->fresh()->assigned_officer_id);
        $this->assertCount(1, Assignments::live($application), 'one holder per job, always');

        Assignments::end(Assignments::live($application)->first(), $admin);
        $this->assertNull($application->fresh()->assigned_officer_id);
    }

    public function test_ending_an_assignment_clears_the_cache_and_leaves_the_status_alone(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $application = $this->application($admin);

        $this->assign($admin, $application, $officer)->assertCreated();

        $this->actingAs($admin)
            ->deleteJson('/portal/cip/applications/'.$application->uuid.'/assignments/'.$officer->id)
            ->assertOk()
            ->assertJsonCount(0, 'assignments');

        $fresh = $application->fresh();
        $this->assertNull($fresh->assigned_officer_id);
        // An application between officers is still under review.
        $this->assertSame(Status::REVIEW_APPLICATION, $fresh->status);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id, 'action' => 'unassigned', 'actor_id' => $admin->id,
        ]);
    }

    public function test_handing_the_file_to_whoever_already_holds_it_is_not_a_change(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $application = $this->application($admin);

        $first = Assignments::assign($application, $officer, $admin);
        $again = Assignments::assign($application->fresh(), $officer, $admin);

        $this->assertSame($first->id, $again->id, 'the same row, not a second one');
        $this->assertSame(1, CipApplicationAssignment::where('application_id', $application->id)->count());
    }

    public function test_an_officer_cannot_hand_the_file_to_somebody_else(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $sam = $this->user(Role::REVIEWING_OFFICER, 'sam@example.com', 'Sam Reviewer');
        $application = $this->application($admin);

        // §10 keeps assignment with the administrator. An officer HOLDING the
        // file still may not hand it on — they can see it, so the refusal is
        // a 403 about the verb, not a 404 about the file.
        Assignments::assign($application, $rita, $admin);
        $this->assign($rita, $application->fresh(), $sam)->assertForbidden();

        // An officer the file was never given cannot even see it: the same
        // ask from them is a 404, because being refused the right to staff an
        // application would otherwise tell them it exists.
        $dana = $this->user(Role::REVIEWING_OFFICER, 'dana@example.com', 'Dana Review');
        $this->assign($dana, $application->fresh(), $sam)->assertNotFound();

        // A stranger is not told the application is there at all.
        $stranger = $this->user(Role::CLIENT, 'nobody@example.com', 'Nobody');
        $this->assign($stranger, $application, $sam)->assertNotFound();

        // Rita's own row is the only one: none of the refused asks stuck.
        $this->assertSame(1, CipApplicationAssignment::count());
        $this->assertSame($rita->id, CipApplicationAssignment::first()->user_id);
    }

    public function test_the_assignable_list_leaves_out_whoever_is_already_on_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        $application = $this->application($admin);

        $before = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/assignments')
            ->assertOk()->json('assignable');

        // Both officer types are offered; the administrator is not, reaching
        // every application already.
        $this->assertEqualsCanonicalizing([$colin->id, $rita->id], array_column($before, 'id'));

        $this->assign($admin, $application, $rita)->assertCreated();

        $after = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/assignments')
            ->assertOk()->json('assignable');

        $this->assertSame([$colin->id], array_column($after, 'id'));
    }

    public function test_assigning_names_the_officer_in_the_table_column(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $application = $this->filed($admin);

        $this->assign($admin, $application, $officer)->assertCreated();

        $row = $this->actingAs($admin)
            ->getJson('/portal/cip/applications')
            ->assertOk()
            ->json('applications.0');

        $this->assertSame('Rita Reviewer', $row['assignedTo'][0]['name'] ?? null);
        $this->assertDatabaseHas('client_assignments', [
            'client_id' => $application->client_id,
            'user_id' => $officer->id,
            'status' => ClientAssignment::STATUS_ACTIVE,
        ]);
    }

    public function test_somebody_already_on_the_client_is_not_offered_again(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        $application = $this->filed($admin);

        ClientAssignment::create([
            'client_id' => $application->client_id,
            'user_id' => $rita->id,
            'assigned_by' => $admin->id,
            'role' => 'reviewing_officer',
            'permission_level' => 'editor',
            'status' => ClientAssignment::STATUS_ACTIVE,
        ]);

        $body = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/assignments')
            ->assertOk()
            ->json();

        $this->assertSame([$rita->id], array_column($body['assignments'], 'userId'));
        $this->assertSame([$colin->id], array_column($body['assignable'], 'id'));
    }

    public function test_assigning_emails_the_officer_in_the_compliance_format(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Marshall');
        $application = $this->filed($admin);

        $this->assign($admin, $application, $officer)->assertCreated();

        /*
         * §10 names the contents and §22 names the subject. These emails are
         * filed, and a mailbox full of them is sorted by exactly the fields
         * the subject carries — so the format is pinned literally, not "some
         * subject mentioning the number".
         */
        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($application) {
            $expected = 'AA - REVIEW APPLICATION - '.$application->displayNumber()
                .' - CHEN WEI (F1) - '.now()->format('d.m.Y');

            if ($mail->subjectLine !== $expected) {
                return false;
            }

            $details = collect($mail->payload['details'])->mapWithKeys(fn ($row) => [$row[0] => $row[1]]);

            return $mail->hasTo('rita@example.com')
                && $details['Application'] === $application->displayNumber()
                && $details['Applicant'] === 'Chen Wei'
                && $details['Service provider'] === 'Galaxy'
                // The body says where the file stands, not only the subject:
                // the status is the one fact that decides what kind of work
                // just landed.
                && $details['Status'] === 'Review Applications'
                && str_contains($mail->payload['lead'], 'Review Applications')
                // The public address, whatever host fired the request.
                && str_starts_with($mail->payload['button']['url'], rtrim(config('app.url'), '/').'/citizenship-applications/');
        });

        // Tracked on the file: the send is a row against this application, so
        // the audit trail can answer "was the officer told, and when".
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'rita@example.com',
            'template' => 'cip-assigned',
        ]);
    }

    public function test_one_press_is_one_email(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Marshall');
        $application = $this->filed($admin);

        $this->assign($admin, $application, $officer)->assertCreated();

        /*
         * The picker writes the client assignment too (the Assigned tab and
         * the table are one list), and that path carries its own welcome
         * email. Left both on, one press arrived as two emails saying
         * different things about the same fact. §22 fans the status notice
         * to every named class; none of those copies is the client-assignment
         * welcome.
         */
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
        $this->assertDatabaseMissing('email_deliveries', [
            'template' => 'staffAssignedToClient',
        ]);
        $this->assertTrue(
            collect(EmailDelivery::pluck('template'))->every(fn ($t) => $t === 'cip-assigned'),
        );
    }

    public function test_the_provider_firm_comes_with_the_file_and_goes_back_with_the_last_one(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Marshall');

        $firm = Company::create(['uid' => 'galaxy-partners', 'name' => 'Galaxy Partners']);
        $provider = CipProvider::create(['name' => 'Galaxy Partners', 'code' => 'GAL', 'company_id' => $firm->id]);

        $first = $this->filedUnder($provider, $admin, 'chen-wei');
        $second = $this->filedUnder($provider, $admin, 'test-applicant');

        // Nothing yet: the officer's hub starts empty.
        $this->assertCount(0, CompanyScope::query($officer)->get());

        $this->assign($admin, $first, $officer)->assertCreated();

        /*
         * The firm arrived with the file, automatically — its contact details
         * are what a reviewer needs to chase a document — and it opens the
         * firm's page only: on that page the officer reads their own people,
         * not the book. Galaxy has two referred applicants; the officer holds
         * one file, so the page counts exactly one person.
         */
        $this->assertSame(['Galaxy Partners'], CompanyScope::query($officer)->pluck('name')->all());

        $shown = $this->actingAs($officer)
            ->getJson('/portal/companies/galaxy-partners')
            ->assertOk()
            ->json('company');
        $this->assertSame(1, $shown['referredCount'] ?? $shown['referred_clients_count'] ?? null,
            'their one applicant, not the firm\'s book of two');

        $this->assign($admin, $second, $officer)->assertCreated();

        // One file handed back: the firm stays for the other.
        $this->actingAs($admin)
            ->deleteJson('/portal/cip/applications/'.$first->uuid.'/assignments/'.$officer->id)
            ->assertOk();
        $this->assertCount(1, CompanyScope::query($officer)->get(), 'still working the second file');

        // The last file handed back: the firm goes with it.
        $this->actingAs($admin)
            ->deleteJson('/portal/cip/applications/'.$second->uuid.'/assignments/'.$officer->id)
            ->assertOk();
        $this->assertCount(0, CompanyScope::query($officer)->get());
    }

    public function test_a_company_grant_made_by_hand_survives_the_file_leaving(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Marshall');

        $firm = Company::create(['uid' => 'galaxy-partners', 'name' => 'Galaxy Partners']);
        $provider = CipProvider::create(['name' => 'Galaxy Partners', 'code' => 'GAL', 'company_id' => $firm->id]);
        $application = $this->filedUnder($provider, $admin, 'chen-wei');

        // An administrator put the officer on the firm deliberately, before
        // any file: that grant is theirs, and the workflow must not treat it
        // as its own to take back.
        CompanyStaffAssignment::create([
            'company_id' => $firm->id, 'user_id' => $officer->id,
            'role' => 'general', 'permission_level' => 'view_files',
            'applies_to_clients' => CompanyStaffAssignment::SCOPE_COMPANY_ONLY,
            'status' => CompanyStaffAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);

        $this->assign($admin, $application, $officer)->assertCreated();
        $this->actingAs($admin)
            ->deleteJson('/portal/cip/applications/'.$application->uuid.'/assignments/'.$officer->id)
            ->assertOk();

        $this->assertCount(1, CompanyScope::query($officer)->get(),
            'the hand-made grant is not the workflow\'s to end');
    }

    /** An application filed under a specific provider, with its client. */
    private function filedUnder(CipProvider $provider, User $creator, string $uid): CipApplication
    {
        $application = Applications::create($provider, $creator);
        $client = Client::create([
            'uid' => $uid.'-'.$application->id, 'name' => ucwords(str_replace('-', ' ', $uid)),
            // The filing firm is the referrer — what intake writes, and what
            // the provider tab's counts read.
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $provider->company_id,
            'data' => [], 'created_by' => $creator->id,
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application->refresh();
    }
}
