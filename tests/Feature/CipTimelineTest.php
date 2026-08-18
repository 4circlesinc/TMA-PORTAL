<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use App\Support\Cip\Submission;
use App\Support\Cip\Timeline;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The Activity tab — an application's own history, read out of cip_events.
 *
 * The sentences are the subject of most of this. cip_events stores codes, and
 * a tab that showed them would be asking a reviewer to learn the schema; every
 * line has to arrive in the English somebody would use about the file. The rest
 * guards the two ways a history goes wrong: reading one that is not yours, and
 * costing a query per line.
 */
class CipTimelineTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The module ships dark behind FEATURE_CIP, and every cip.* capability
        // is denied — administrators included — while it is off.
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    /** A filed draft with one applicant on it, and one event to its name. */
    private function application(User $creator): CipApplication
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $creator);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application->refresh();
    }

    private function document(CipApplication $application, string $label): CipDocument
    {
        return CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $application->people()->value('id'),
            'type' => 'police_certificate',
            'label' => $label,
        ])->refresh();
    }

    /**
     * The sentences of one history, newest first.
     *
     * @return list<string>
     */
    private function lines(CipApplication $application, User $viewer): array
    {
        return array_column(Timeline::for($application, $viewer), 'what');
    }

    public function test_filing_and_moving_read_as_sentences(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        Engine::apply($application, Status::REVIEW_APPLICATION, $admin);

        // Newest first, and neither line mentions a status code: the labels
        // are the same words the buckets use.
        $this->assertSame([
            'Ada Admin moved it from New Applications to Review Applications',
            'Ada Admin filed the application',
        ], $this->lines($application, $admin));
    }

    public function test_assigning_and_unassigning_name_the_officer(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $application = $this->application($admin);

        Assignments::assign($application->fresh(), $rita, $admin);

        $lines = $this->lines($application, $admin);
        $this->assertContains('Ada Admin assigned Rita Officer', $lines);
        // §10's other half: the assignment is what started the review, and the
        // history says so in its own line rather than implying it.
        $this->assertContains('Ada Admin moved it from New Applications to Review Applications', $lines);

        Assignments::end(Assignments::live($application)->first(), $admin);

        $this->assertContains('Ada Admin ended Rita Officer’s assignment', $this->lines($application, $admin));
    }

    public function test_the_cip_number_reads_as_a_sentence_and_a_correction_says_so(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        foreach ([Status::REVIEW_APPLICATION, Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT] as $to) {
            Engine::apply($application, $to, $admin);
        }

        $application->forceFill(['locked_at' => now()])->save();

        Submission::record($application, $admin, '10T1G12661P');

        $this->assertContains(
            'Ada Admin recorded the CIP number 10T1G12661P',
            $this->lines($application, $admin),
        );

        // Same action, different event: a digit fixed must not read as the
        // application having been submitted twice.
        Submission::correct($application->fresh(), $admin, '10T1G12662P');

        $this->assertSame(
            'Ada Admin corrected the CIP number to 10T1G12662P',
            $this->lines($application, $admin)[0],
        );
    }

    public function test_a_document_verdict_names_the_document(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $application = $this->application($admin);
        $document = $this->document($application, 'Police certificate');

        // Up for review, sent back, up again, accepted — the revision loop §12
        // describes, which is the whole of what this tab shows for a document.
        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $admin);
        DocumentEngine::apply($document->fresh(), DocumentStatus::UPDATE_REQUIRED, $rita);
        DocumentEngine::apply($document->fresh(), DocumentStatus::APPLICATION_REVIEW, $admin);
        DocumentEngine::apply($document->fresh(), DocumentStatus::READY_FOR_SUBMISSION, $rita);

        $lines = $this->lines($application, $admin);

        // The label comes off the slot: the event's meta carries its uuid and
        // its two statuses, and none of those is a thing to read.
        $this->assertContains('Rita Officer sent back Police certificate', $lines);
        $this->assertContains('Rita Officer approved Police certificate', $lines);
        $this->assertContains('Ada Admin uploaded Police certificate', $lines);
    }

    public function test_an_action_nobody_has_taught_it_still_reads_as_something(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        // A later phase's action, arriving in a table this file cannot be
        // edited every time somebody adds one.
        Engine::record($application, 'phase_nine_widget', $admin);

        $entry = Timeline::for($application, $admin)[0];

        $this->assertSame('phase_nine_widget', $entry['action'], 'the raw action still travels for the icon');
        $this->assertSame('Phase nine widget by Ada Admin', $entry['what']);
    }

    public function test_a_recorded_decision_reads_as_the_outcome(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $admin, [
            'decision' => Status::GRANTED,
        ]);

        $entry = Timeline::for($application, $admin)[0];

        $this->assertSame(CipEvent::ACTION_DECISION_RECORDED, $entry['action']);
        $this->assertSame('Ada Admin recorded the decision: Approved', $entry['what']);
    }

    public function test_a_null_actor_reads_as_the_system(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        // What a scheduled job leaves behind: an event with nobody on it.
        Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, null, [], Status::NEW, Status::REVIEW_APPLICATION);

        $entry = Timeline::for($application, $admin)[0];

        $this->assertSame('the system', $entry['who']['name']);
        $this->assertNull($entry['who']['avatar']);
        $this->assertSame('The system moved it from New Applications to Review Applications', $entry['what']);
    }

    public function test_a_reader_outside_the_scope_is_told_the_history_is_not_there(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);
        $url = '/portal/cip/applications/'.$application->uuid.'/events';

        $this->actingAs($admin)->getJson($url)
            ->assertOk()
            ->assertJsonPath('events.0.what', 'Ada Admin filed the application');

        // 404 and not 403: being refused a file's history is still being told
        // the file exists.
        $stranger = $this->user(Role::CLIENT, 'nobody@example.com', 'Nobody');
        $this->actingAs($stranger)->getJson($url)->assertNotFound();

        /*
         * A second stranger, to prove the 404 is about the slice and not about
         * one account. Not an Employee: that type never reaches a portal route
         * at all — EnsureAccountApproved holds it at /auth/role-pending — so it
         * would prove the redirect rather than the scope.
         */
        $other = $this->user(Role::CLIENT, 'ed@example.com', 'Ed Other');
        $this->actingAs($other)->getJson($url)->assertNotFound();

        // The same answer from the class itself, so a caller that resolved the
        // application some other way cannot read a history round the scope.
        $this->assertSame([], Timeline::for($application, $stranger));
    }

    public function test_the_query_count_does_not_grow_with_the_history(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        $application = $this->application($admin);

        // A document event in both runs, so the label lookup is in both counts.
        $document = $this->document($application, 'Police certificate');
        DocumentEngine::apply($document, DocumentStatus::APPLICATION_REVIEW, $admin);

        $this->fill($application, [$admin, $rita, $colin], 4);

        DB::enableQueryLog();
        $short = Timeline::for($application, $admin, Timeline::MAX_LIMIT);
        $cheap = count(DB::getQueryLog());
        DB::disableQueryLog();

        // The logger goes off around the seeding: sixty inserts are the cost of
        // arranging the test, not of reading it back.
        $this->fill($application, [$admin, $rita, $colin], 60);

        DB::enableQueryLog();
        DB::flushQueryLog();
        $long = Timeline::for($application, $admin, Timeline::MAX_LIMIT);
        $dear = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertCount(6, $short);
        $this->assertCount(66, $long, 'the long read really did read them all');

        $this->assertSame($dear, $cheap, "Six events cost {$cheap} queries and sixty-six cost {$dear}: "
            .'the actors or the documents are being fetched a row at a time.');
        $this->assertLessThanOrEqual(5, $dear, 'the scope check, the events, their actors, their documents');
    }

    /** Events by three different people, to catch a per-actor lookup. */
    private function fill(CipApplication $application, array $actors, int $count): void
    {
        foreach (range(1, $count) as $n) {
            Engine::record(
                $application,
                CipEvent::ACTION_STATUS_CHANGED,
                $actors[$n % count($actors)],
                [],
                Status::NEW,
                Status::REVIEW_APPLICATION,
            );
        }
    }
}
