<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Assignments;
use App\Support\Cip\Buckets;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * §9 — the action-driven dashboards.
 *
 * Three things are being held to account here. Each role is offered exactly
 * the buckets the brief promises it and nobody else's; every count is measured
 * through the reader's own slice, so a chip can never report work they are not
 * allowed to see; and the filter a bucket hands back finds exactly the rows it
 * counted, because a number that opens onto a different set of rows is the
 * dashboard misleading the person acting on it.
 */
class CipBucketTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The module ships dark behind FEATURE_CIP, and nothing below exists
        // for anybody while it is off.
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email): User
    {
        $user = User::create([
            'name' => ucfirst(strtok($email, '@')),
            'email' => $email,
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    /** A provider firm with one active contact who can sign in. */
    private function providerWithContact(string $code): array
    {
        $company = Company::create(['uid' => strtolower($code).'-firm', 'name' => $code.' Firm']);
        $contact = $this->user(Role::CLIENT, strtolower($code).'-contact@example.com');

        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $provider = CipProvider::create([
            'name' => $code.' Provider', 'code' => $code, 'company_id' => $company->id,
        ]);

        return [$provider, $contact];
    }

    /**
     * An application seeded straight at a status, and optionally in an
     * officer's hands.
     *
     * The statuses are written rather than walked to. This phase is a counting
     * exercise: the edges that reach Background check belong to the phases that
     * build them and are tested there, and driving each fixture through eight
     * transitions would make this file fail whenever the lifecycle changed
     * shape rather than when a bucket did. One test below does use the product
     * path, because assignment is what fills an officer's queue.
     */
    private function application(
        CipProvider $provider,
        User $creator,
        string $status,
        ?User $officer = null,
    ): CipApplication {
        $application = Applications::create($provider, $creator);

        $application->forceFill([
            'status' => $status,
            'assigned_officer_id' => $officer?->id,
        ])->save();

        return $application;
    }

    /** This reader's dashboard as bucket key => count. */
    private function counts(User $user): array
    {
        $buckets = $this->actingAs($user)
            ->getJson('/portal/cip/dashboard')
            ->assertOk()
            ->json('buckets');

        return array_column($buckets, 'count', 'key');
    }

    /** The same dashboard as bucket key => tone. */
    private function tones(User $user): array
    {
        $buckets = $this->actingAs($user)
            ->getJson('/portal/cip/dashboard')
            ->assertOk()
            ->json('buckets');

        return array_column($buckets, 'tone', 'key');
    }

    /** What this reader's dashboard says about which side of the firm they sit on. */
    private function staffFlag(User $user): mixed
    {
        return $this->actingAs($user)
            ->getJson('/portal/cip/dashboard')
            ->assertOk()
            ->json('staff');
    }

    /** Somebody the firm holds a client record for, and no more than that. */
    private function privateClient(string $email): User
    {
        $account = $this->user(Role::CLIENT, $email);

        Client::create([
            'uid' => strtok($email, '@'),
            'name' => $account->name,
            'user_id' => $account->id,
            'data' => [],
        ]);

        return $account;
    }

    public function test_the_administrator_dashboard_is_section_9s_ten_buckets(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');

        $body = $this->actingAs($admin)->getJson('/portal/cip/dashboard')->assertOk()->json();

        $this->assertTrue($body['cip']);
        $this->assertSame(Buckets::ADMINISTRATOR, $body['dashboard']);
        $this->assertSame([
            'New Applications', 'Review Applications', 'Assessment Feedback', 'Updates Required',
            'Ready to Submit', 'Pending Review', 'Background Check', 'Delayed', 'Approved', 'Denied',
        ], array_column($body['buckets'], 'label'), 'The order is §9’s, not a renderer’s choice.');
    }

    public function test_the_reviewing_officer_dashboard_is_four_personal_queues(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');

        $body = $this->actingAs($officer)->getJson('/portal/cip/dashboard')->assertOk()->json();

        $this->assertSame(Buckets::REVIEWING_OFFICER, $body['dashboard']);
        $this->assertSame([
            'Assigned Reviews', 'Reviews Pending', 'Assessment Feedback Tasks',
            'Additional Information Requests',
        ], array_column($body['buckets'], 'label'));

        // Every one of them is the officer's own work. A CRO bucket counted
        // over the whole firm would be a report wearing a work queue's name.
        $this->assertSame(
            array_fill(0, 4, Buckets::SCOPE_MINE),
            array_column($body['buckets'], 'scope'),
        );
    }

    public function test_the_service_provider_dashboard_is_the_applicant_facing_six(): void
    {
        [, $contact] = $this->providerWithContact('GAL');

        $body = $this->actingAs($contact)->getJson('/portal/cip/dashboard')->assertOk()->json();

        $this->assertSame(Buckets::SERVICE_PROVIDER, $body['dashboard']);
        $this->assertSame([
            'Updates Required', 'Ready to Submit', 'Pending Review', 'Delayed', 'Approved', 'Denied',
        ], array_column($body['buckets'], 'label'));

        // A provider firm has no queue of its own — what it sees is its whole
        // book, which ApplicationScope has already narrowed to its own files.
        $this->assertSame(
            array_fill(0, 6, Buckets::SCOPE_ALL),
            array_column($body['buckets'], 'scope'),
        );
    }

    public function test_a_compliance_officer_reads_the_administrators_dashboard(): void
    {
        $officer = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com');

        $body = $this->actingAs($officer)->getJson('/portal/cip/dashboard')->assertOk()->json();

        // §9 names three sets and none of them is theirs. The compliance tail
        // — Pending review, Background check, Delayed, and both decisions — is
        // in the administrator's ten, so that is what they are given.
        $this->assertSame(Buckets::ADMINISTRATOR, $body['dashboard']);
        $this->assertCount(10, $body['buckets']);
    }

    public function test_the_three_working_roles_are_staff(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');

        // The home screen's CIP card is offered on this flag alone, so all
        // three have to answer it — the two officer types are the ones a
        // capability check would be tempted to sort into "not administrator"
        // and drop, and they are exactly who opens that card each morning.
        foreach ([$admin, $colin, $rita] as $reader) {
            $this->assertTrue($this->staffFlag($reader), $reader->email.' works here.');
        }
    }

    public function test_neither_external_reader_is_staff(): void
    {
        [, $contact] = $this->providerWithContact('GAL');
        $applicant = $this->privateClient('asem@example.com');

        /*
         * The bug this flag exists for.
         *
         * Both of these reach the module — they are promised their own
         * applications — and Buckets::setFor hands both of them the same
         * SERVICE_PROVIDER six, so the dashboard name says nothing about which
         * side of the firm a reader is on. A home screen that inferred it from
         * the set would have drawn the firm's CIP card for every external
         * account in the portal.
         */
        foreach ([$contact, $applicant] as $reader) {
            $body = $this->actingAs($reader)->getJson('/portal/cip/dashboard')->assertOk()->json();

            $this->assertTrue($body['cip'], $reader->email.' still reaches the module.');
            $this->assertSame(Buckets::SERVICE_PROVIDER, $body['dashboard']);
            $this->assertFalse($body['staff'], $reader->email.' does not work here.');
        }
    }

    public function test_every_bucket_carries_a_tone_the_design_system_can_draw(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        [, $contact] = $this->providerWithContact('GAL');

        /*
         * The five the portal has, and there is no sixth to invent.
         *
         * They are rendered as `.tma-portal-status--<tone>`, so a bucket that
         * answered with a word outside this list would not be drawn in some
         * other colour — it would be drawn in none, and the dot beside a count
         * would silently disappear on whichever dashboard grew the new word.
         */
        $vocabulary = ['success', 'danger', 'pending', 'action', 'neutral'];

        foreach ([$admin, $rita, $contact] as $reader) {
            foreach ($this->tones($reader) as $key => $tone) {
                $this->assertContains($tone, $vocabulary, $key.' must wear a tone the portal styles.');
            }
        }
    }

    public function test_a_bucket_wears_the_tone_of_the_status_it_is_named_for(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');

        $tones = $this->tones($admin);

        // Pinned to the colour, not to the call that produced it: asking
        // Status::tone() what Status::tone() answered would pass however the
        // mapping was rewritten, and these are the four the whole vocabulary
        // hangs off — work to pick up, a wait, and the two decisions.
        $this->assertSame('action', $tones['new']);
        $this->assertSame('pending', $tones['pending_review']);
        $this->assertSame('success', $tones['approved']);
        $this->assertSame('danger', $tones['denied']);

        // And it is the status's own tone, not a second table kept beside it.
        // Approved counts GRANTED under §9's word for it, so the bucket and
        // every chip inside it are coloured by the one mapping.
        $this->assertSame(Status::tone(Status::GRANTED), $tones['approved']);

        // The one bucket covering several statuses takes the first, which is
        // the state its name describes and the one work arrives in.
        $this->assertSame(
            Status::tone(Status::REVIEW_APPLICATION),
            $this->tones($rita)['assigned_reviews'],
        );
    }

    public function test_a_reader_the_module_is_not_for_gets_an_empty_payload_not_a_refusal(): void
    {
        /*
         * A Client with no application: someone the portal lets in and the
         * module has nothing for.
         *
         * Not an Employee, which is what this reached for first — that type is
         * held at /auth/role-pending by EnsureAccountApproved and cannot reach
         * any portal route at all, so it proves the redirect rather than this
         * endpoint's manners.
         */
        $outsider = $this->user(Role::CLIENT, 'eve@example.com');

        /*
         * Exact, and that is load-bearing now the served payload also carries
         * `staff`. A reader with no dashboard is answered the one question
         * they asked; going on to describe who they are would be the module
         * telling the browser about somebody it just said it has nothing for.
         */
        $this->actingAs($outsider)
            ->getJson('/portal/cip/dashboard')
            ->assertOk()
            ->assertExactJson(['cip' => false, 'buckets' => []]);
    }

    public function test_the_dark_module_offers_nobody_a_dashboard(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');

        config(['services.cip.enabled' => false]);

        $this->actingAs($admin)
            ->getJson('/portal/cip/dashboard')
            ->assertOk()
            ->assertExactJson(['cip' => false, 'buckets' => []]);
    }

    public function test_counts_are_measured_through_the_readers_own_slice(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        [$galaxy, $galaxyContact] = $this->providerWithContact('GAL');
        [$bluemina] = $this->providerWithContact('BLU');

        $this->application($galaxy, $admin, Status::PENDING_REVIEW);
        // The other firm's file. Counting it would tell the Galaxy contact how
        // much work exists at a competitor, which is a leak even with no name
        // attached to the number.
        $this->application($bluemina, $admin, Status::PENDING_REVIEW);

        $this->assertSame(1, $this->counts($galaxyContact)['pending_review']);
        $this->assertSame(2, $this->counts($admin)['pending_review']);
    }

    public function test_an_officers_queue_counts_only_the_files_they_hold(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        $omar = $this->user(Role::REVIEWING_OFFICER, 'omar@example.com');
        [$galaxy] = $this->providerWithContact('GAL');

        $this->application($galaxy, $admin, Status::REVIEW_APPLICATION, $rita);
        $this->application($galaxy, $admin, Status::ASSESSMENT_FEEDBACK, $rita);
        $this->application($galaxy, $admin, Status::REVIEW_APPLICATION, $omar);
        // Held by nobody, and therefore in nobody's queue.
        $this->application($galaxy, $admin, Status::REVIEW_APPLICATION);

        $hers = $this->counts($rita);

        $this->assertSame(2, $hers['assigned_reviews']);
        $this->assertSame(1, $hers['reviews_pending']);
        $this->assertSame(1, $hers['assessment_feedback_tasks']);
        $this->assertSame(0, $hers['information_requests']);

        $this->assertSame(1, $this->counts($omar)['assigned_reviews']);

        // The same four applications, counted as a report rather than a queue.
        $this->assertSame(3, $this->counts($admin)['review_application']);
    }

    public function test_assigning_a_file_puts_it_in_that_officers_queue(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        [$galaxy] = $this->providerWithContact('GAL');

        $application = Applications::create($galaxy, $admin);

        $this->assertSame(0, $this->counts($rita)['assigned_reviews']);

        Assignments::assign($application, $rita, $admin);

        // §10: the assignment both hands the file over and starts the review,
        // so one product action fills two of her buckets at once.
        $hers = $this->counts($rita);
        $this->assertSame(1, $hers['assigned_reviews']);
        $this->assertSame(1, $hers['reviews_pending']);
    }

    public function test_every_bucket_filter_finds_exactly_the_rows_its_count_promised(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        [$galaxy, $contact] = $this->providerWithContact('GAL');
        [$bluemina] = $this->providerWithContact('BLU');

        $mine = $this->application($galaxy, $admin, Status::REVIEW_APPLICATION, $rita);
        $this->application($galaxy, $admin, Status::UPDATE_REQUIRED, $rita);
        $this->application($galaxy, $admin, Status::PENDING_REVIEW);
        $this->application($galaxy, $admin, Status::GRANTED);
        $this->application($bluemina, $admin, Status::DELAYED);
        $this->application($bluemina, $admin, Status::DENIED);

        foreach ([$admin, $rita, $contact] as $reader) {
            $dashboard = $this->actingAs($reader)->getJson('/portal/cip/dashboard')->assertOk();

            foreach ($dashboard->json('buckets') as $bucket) {
                $definition = Buckets::find($reader, $bucket['filter']['bucket']);

                $this->assertSame(
                    $bucket['count'],
                    Buckets::apply(ApplicationScope::query($reader), $definition, $reader)->count(),
                    $bucket['label'].' must find the rows it counted.',
                );
            }
        }

        // Not merely the same number: the same application. A personal queue
        // that counted one file and opened another would be the worst version
        // of this bug, because both halves would look right.
        $this->assertSame(
            [$mine->id],
            Buckets::apply(
                ApplicationScope::query($rita),
                Buckets::find($rita, 'reviews_pending'),
                $rita,
            )->pluck('id')->all(),
        );
    }

    public function test_a_bucket_from_somebody_elses_dashboard_is_not_theirs_to_filter_by(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $employee = $this->user(Role::EMPLOYEE, 'eve@example.com');
        [, $contact] = $this->providerWithContact('GAL');

        $this->assertNotNull(Buckets::find($admin, 'background_check'));
        // An administrator holds no queue of their own, a provider firm sees
        // no compliance stage, and a plain employee has no dashboard at all.
        $this->assertNull(Buckets::find($admin, 'assigned_reviews'));
        $this->assertNull(Buckets::find($contact, 'background_check'));
        $this->assertNull(Buckets::find($employee, 'new'));
    }

    public function test_approved_is_the_granted_bucket(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        [$galaxy] = $this->providerWithContact('GAL');

        $this->application($galaxy, $admin, Status::GRANTED);

        $buckets = $this->actingAs($admin)->getJson('/portal/cip/dashboard')->assertOk()->json('buckets');
        $approved = collect($buckets)->firstWhere('key', 'approved');

        // Client question 1: the dashboard's word and the engine's word for
        // one set of applications. The label is the brief's, the query is the
        // lifecycle's, and confirming the wording changes only the label.
        $this->assertSame('Approved', $approved['label']);
        $this->assertSame([Status::GRANTED], $approved['statuses']);
        $this->assertSame(1, $approved['count']);
    }

    public function test_a_draft_is_in_nobody_s_bucket(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        [$galaxy, $contact] = $this->providerWithContact('GAL');

        // Applications are born at DRAFT, so this is what an unfinished form
        // looks like — visible to the side writing it, work for nobody.
        $this->application($galaxy, $admin, Status::DRAFT);

        $this->assertSame(0, array_sum($this->counts($admin)));
        $this->assertSame(0, array_sum($this->counts($contact)));
    }

    public function test_the_whole_set_is_one_count_not_one_per_bucket(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        [$galaxy] = $this->providerWithContact('GAL');

        foreach ([Status::NEW, Status::PENDING_REVIEW, Status::GRANTED] as $status) {
            $this->application($galaxy, $admin, $status);
        }

        DB::enableQueryLog();
        $buckets = Buckets::for($admin);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertCount(10, $buckets);
        $this->assertCount(1, $queries, 'Ten buckets are one grouped count, not ten questions.');
    }
}
