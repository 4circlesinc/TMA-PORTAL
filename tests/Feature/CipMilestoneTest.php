<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Milestones;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * §4d — the Timeline card on Overview.
 *
 * The card is a timeline, so the two things worth guarding are the order it
 * reads in and the holes in it: a step still ahead of the file has to come back
 * as a step with no date, because dropping it would tell a reader the
 * application had finished travelling.
 *
 * The officer travels with it, out of the same record — so the last of these
 * counts the queries. A page of fifty applications is what this payload is
 * built for, and naming an officer is the sort of thing that quietly costs one
 * question per row.
 */
class CipMilestoneTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The module ships dark behind FEATURE_CIP, and nobody reaches it —
        // administrators included — while it is off.
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

    private function application(User $creator, string $code = 'GAL'): CipApplication
    {
        $provider = CipProvider::firstOrCreate(['code' => $code], ['name' => $code.' Provider']);

        return Applications::create($provider, $creator);
    }

    public function test_the_timeline_is_the_order_an_application_travels(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');

        $this->assertSame(
            ['filed', 'locked', 'submitted', 'query_received', 'accepted', 'decision'],
            array_column(Milestones::for($this->application($admin)), 'key'),
            'The card is a journey, and the journey has an order.',
        );
    }

    public function test_a_step_the_file_has_not_reached_is_still_on_the_card(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        $milestones = collect(Milestones::for($application))->keyBy('key');

        // Filed is the only thing that has happened to a new application.
        $this->assertTrue($milestones['filed']['reached']);
        $this->assertSame(now()->toDateString(), $milestones['filed']['date']);

        foreach (['submitted', 'query_received', 'accepted', 'decision'] as $ahead) {
            $this->assertArrayHasKey($ahead, $milestones, $ahead.' is what the file has left to do, not something to hide.');
            $this->assertNull($milestones[$ahead]['date']);
            $this->assertFalse($milestones[$ahead]['reached']);
        }
    }

    /**
     * A day, not a moment.
     *
     * These are DATE columns and the portal prints every instant in the
     * reader's own zone, so a milestone carrying a time would land on a
     * different day for a colleague in another country — an audit trail that
     * disagrees with itself depending on who opens it.
     */
    public function test_the_dates_are_plain_days(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);
        $application->forceFill(['submitted_at' => '2026-08-01 23:45:00'])->save();

        $submitted = collect(Milestones::for($application->refresh()))->firstWhere('key', 'submitted');

        $this->assertSame('2026-08-01', $submitted['date']);
    }

    public function test_the_decision_step_says_what_was_decided(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        $decision = fn (CipApplication $a) => collect(Milestones::for($a))->firstWhere('key', 'decision');

        // Nothing decided yet: the step is still the question.
        $this->assertSame('Decision', $decision($application)['label']);

        $application->forceFill([
            'decided_at' => '2026-08-10',
            'decision' => CipApplication::DECISION_GRANTED,
        ])->save();

        $granted = $decision($application->refresh());
        $this->assertSame('Approved', $granted['label']);
        $this->assertSame('2026-08-10', $granted['date']);
        $this->assertTrue($granted['reached']);

        $application->forceFill(['decision' => CipApplication::DECISION_DENIED])->save();

        $this->assertSame('Denied', $decision($application->refresh())['label']);
    }

    public function test_the_record_carries_the_card_and_the_officer(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'omar@example.com', 'Omar Reviewer');
        $application = $this->application($admin);

        Assignments::assign($application, $officer, $admin, CipAccess::REVIEWING_OFFICER);

        $body = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertCount(6, $body['milestones']);
        $this->assertSame('Filed', $body['milestones'][0]['label']);
        $this->assertSame('Omar Reviewer', $body['assignedOfficer']['name']);
        $this->assertSame('omar@example.com', $body['assignedOfficer']['email']);
        $this->assertArrayHasKey('avatar', $body['assignedOfficer']);
        $this->assertSame('Omar Reviewer', $body['assignedTo'][0]['name'] ?? null);
    }

    public function test_an_application_nobody_holds_names_nobody(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $application = $this->application($admin);

        $body = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        // Null rather than the last officer who held it, and rather than an
        // empty person the card would draw a blank row for.
        $this->assertNull($body['assignedOfficer']);
        $this->assertSame([], $body['assignedTo']);
    }

    public function test_the_officer_leaves_the_record_when_the_assignment_ends(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'omar@example.com', 'Omar Reviewer');
        $application = $this->application($admin);

        $assignment = Assignments::assign($application, $officer, $admin, CipAccess::REVIEWING_OFFICER);
        Assignments::end($assignment, $admin);

        $body = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertNull($body['assignedOfficer']);
        $this->assertSame([], $body['assignedTo']);
    }

    /**
     * The officer must not cost a question per application.
     *
     * The sync endpoint builds this record for every row of a page of fifty, so
     * a relation the record fetches for itself is not one query but fifty — on
     * the catch-up read a laptop makes after a week away, over a connection
     * that is the reason it was offline in the first place. Counted with the
     * same six applications held by nobody and then held by an officer: six
     * officers that arrive together cost one query, and six that are looked up
     * one at a time cost six.
     *
     * The milestones are not measured because they cannot be: they are columns
     * of the row the page has already read.
     */
    public function test_the_officer_does_not_cost_a_query_per_application(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'omar@example.com', 'Omar Reviewer');

        $applications = collect(range(1, 6))->map(function (int $n) use ($admin) {
            $application = $this->application($admin);
            $client = Client::create([
                'uid' => 'chen-wei-'.$n, 'name' => 'Chen Wei',
                'created_by' => $admin->id, 'data' => [],
            ]);
            $application->forceFill(['client_id' => $client->id])->save();
            CipPerson::create([
                'application_id' => $application->id,
                'role' => CipPerson::ROLE_MAIN_APPLICANT,
                'first_name' => 'Chen', 'last_name' => 'Wei',
            ]);

            return $application;
        });

        $this->actingAs($admin);

        $unheld = $this->countSyncQueries();

        $applications->each(fn (CipApplication $a) => Assignments::assign($a, $officer, $admin, CipAccess::REVIEWING_OFFICER));

        $held = $this->countSyncQueries();

        $this->assertLessThanOrEqual(
            $unheld + 1,
            $held,
            "Six unheld applications took {$unheld} queries and six held ones took {$held}. "
            .'The officers must be loaded with the page, not one per application.',
        );
    }

    private function countSyncQueries(): int
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/portal/cip/applications/sync')->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    }
}
