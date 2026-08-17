<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Buckets;
use App\Support\Cip\Facets;
use App\Support\Cip\Status;
use App\Support\Clients\Assignments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * §8's filter menu: the values it offers, and how many rows sit behind each.
 *
 * The promise under test is the one {@see Facets} inherits from
 * {@see Buckets} — the number beside a value and the table
 * that value opens are one definition read twice. Every count here is checked
 * against the list it produces, because a facet reading "Rita Officer 6" that
 * opens onto nine rows is worse than offering no count at all.
 *
 * The rest guards the two ways a facet goes wrong: showing a reader somebody
 * else's work, and costing a query per officer on a table that already has
 * eleven thousand rows in production.
 */
class CipFacetsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

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
     * An application with a client of its own.
     *
     * Every application in production has one — phase 2c creates it at intake
     * — and the Assigned To column reads the client's list, so a fixture
     * without one would be testing the no-client fallback rather than the
     * thing the screen does.
     */
    private function application(CipProvider $provider, User $creator, string $status = Status::NEW): CipApplication
    {
        $application = Applications::create($provider, $creator);
        $client = Client::create([
            'uid' => 'c-'.$application->id,
            'name' => 'Client '.$application->id,
            'data' => [],
            'created_by' => $creator->id,
        ]);
        $application->forceFill(['status' => $status, 'client_id' => $client->id])->save();

        return $application->refresh();
    }

    /** Put somebody on the file, the way both screens do. */
    private function putOn(CipApplication $application, User $staff, User $by): void
    {
        ClientAssignment::create([
            'client_id' => $application->client_id,
            'user_id' => $staff->id,
            'status' => ClientAssignment::STATUS_ACTIVE,
            'assigned_by' => $by->id,
        ]);
    }

    /** The listing, filtered as the menu would filter it. */
    private function listing(User $reader, array $params = []): array
    {
        return $this->actingAs($reader)
            ->getJson('/portal/cip/applications?'.http_build_query($params + ['perPage' => 200]))
            ->assertOk()
            ->json();
    }

    /** One facet list as value => count. */
    private function facet(array $body, string $key): array
    {
        return array_column($body[$key], 'count', 'id');
    }

    public function test_the_officers_holding_work_are_offered_with_their_counts(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        // Three for Rita, one for Colin, two nobody has picked up.
        foreach (range(1, 3) as $ignored) {
            $this->putOn($this->application($provider, $admin), $rita, $admin);
        }
        $this->putOn($this->application($provider, $admin), $colin, $admin);
        $this->application($provider, $admin);
        $this->application($provider, $admin);

        $counts = $this->facet($this->listing($admin), 'assignees');

        $this->assertSame(3, $counts[(string) $rita->id]);
        $this->assertSame(1, $counts[(string) $colin->id]);
        $this->assertSame(2, $counts[Facets::UNASSIGNED]);
    }

    public function test_every_offered_count_matches_the_rows_it_opens(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        [$other] = $this->providerWithContact('PRI');
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        foreach (range(1, 4) as $ignored) {
            $this->putOn($this->application($galaxy, $admin), $rita, $admin);
        }
        $this->application($galaxy, $admin);
        $this->application($other, $admin);

        $body = $this->listing($admin);

        /*
         * The whole promise of the menu, checked value by value rather than on
         * one example: for every row the menu offers, ticking it must produce
         * exactly the number of applications the row advertised. A count and a
         * list that disagree is the portal telling somebody there is work they
         * then cannot find.
         */
        foreach ($body['assignees'] as $facet) {
            $rows = $this->listing($admin, ['assignee' => $facet['id']]);
            $this->assertSame(
                $facet['count'],
                $rows['total'],
                "Assigned to {$facet['name']} offered {$facet['count']} and opened {$rows['total']}.",
            );
        }

        foreach ($body['providers'] as $facet) {
            $rows = $this->listing($admin, ['provider' => $facet['id']]);
            $this->assertSame(
                $facet['count'],
                $rows['total'],
                "Provider {$facet['name']} offered {$facet['count']} and opened {$rows['total']}.",
            );
        }
    }

    public function test_unassigned_means_nobody_holds_it_now(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $held = $this->application($provider, $admin);
        $this->putOn($held, $rita, $admin);

        $handedBack = $this->application($provider, $admin);
        $this->putOn($handedBack, $rita, $admin);

        // Both are held, so the menu offers no unassigned row at all — it is
        // omitted rather than shown as a zero.
        $this->assertSame(0, $this->facet($this->listing($admin), 'assignees')[Facets::UNASSIGNED] ?? 0);

        /*
         * The assignment ends and the file joins the unassigned.
         *
         * An assignment that has run out is not a lighter shade of assigned —
         * the officer has stopped working on it — so a file whose only
         * assignment ended is exactly what "nobody has picked this up" means,
         * and the row stays in the table as history rather than being deleted.
         */
        Assignments::end(
            $handedBack->client,
            $handedBack->client->assignments()->live()->first(),
            $admin,
        );

        $counts = $this->facet($this->listing($admin), 'assignees');
        $this->assertSame(1, $counts[Facets::UNASSIGNED]);
        $this->assertSame(1, $counts[(string) $rita->id], 'the file Rita still holds is still hers');

        $rows = $this->listing($admin, ['assignee' => Facets::UNASSIGNED]);
        $this->assertSame(1, $rows['total']);
    }

    public function test_several_ticks_are_an_or_and_two_fields_are_an_and(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $this->putOn($this->application($provider, $admin, Status::DELAYED), $rita, $admin);
        $this->putOn($this->application($provider, $admin, Status::GRANTED), $colin, $admin);
        $this->application($provider, $admin, Status::DELAYED);

        // Two officers ticked: either one's work, never the intersection.
        $either = $this->listing($admin, ['assignee' => $rita->id.','.$colin->id]);
        $this->assertSame(2, $either['total']);

        // Two buckets ticked, same rule.
        $bothBuckets = $this->listing($admin, ['bucket' => 'delayed,approved']);
        $this->assertSame(3, $bothBuckets['total']);

        /*
         * A second question narrows the first rather than widening it: Rita's
         * files that are ALSO delayed. If the fields were OR'd together this
         * would answer three, which is the whole table.
         */
        $both = $this->listing($admin, ['assignee' => $rita->id, 'bucket' => 'delayed']);
        $this->assertSame(1, $both['total']);

        // And unassigned combines with a name — "not picked up, or Rita's" is
        // the question somebody arranging cover actually asks.
        $cover = $this->listing($admin, ['assignee' => Facets::UNASSIGNED.','.$colin->id]);
        $this->assertSame(2, $cover['total']);
    }

    public function test_a_provider_contact_sees_only_their_own_firm(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');
        [$mine, $contact] = $this->providerWithContact('GAL');
        [$theirs] = $this->providerWithContact('PRI');

        $this->putOn($this->application($mine, $admin), $rita, $admin);
        $this->application($theirs, $admin);
        $this->application($theirs, $admin);

        $body = $this->listing($contact);

        $this->assertSame(['GAL'], array_column($body['providers'], 'code'));
        $this->assertSame(1, $body['providers'][0]['count'], 'their own book and nobody else’s');

        // Rita holds one of theirs, so she is offered — but with the count from
        // this reader's slice, never the firm-wide one.
        $this->assertSame(1, $this->facet($body, 'assignees')[(string) $rita->id]);
    }

    public function test_filtering_by_something_outside_the_slice_is_the_same_as_by_something_that_does_not_exist(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $stranger = $this->user(Role::REVIEWING_OFFICER, 'stranger@example.com');
        [$mine, $contact] = $this->providerWithContact('GAL');
        [$theirs] = $this->providerWithContact('PRI');

        $this->application($mine, $admin);
        $hidden = $this->application($theirs, $admin);
        $this->putOn($hidden, $stranger, $admin);

        $mineOnly = $this->listing($contact)['total'];
        $this->assertSame(1, $mineOnly);

        /*
         * Existence never leaks. Filtering to an officer who really does hold
         * an application — just not one this reader may see — has to answer
         * exactly what filtering to a made-up id answers, or the difference
         * between the two is a way to enumerate the other firm's staff.
         */
        $realButHidden = $this->listing($contact, ['assignee' => (string) $stranger->id]);
        $invented = $this->listing($contact, ['assignee' => '99999']);
        $this->assertSame($invented['total'], $realButHidden['total']);
        $this->assertSame(0, $realButHidden['total']);

        // The same for a provider that exists and is not theirs.
        $otherFirm = $this->listing($contact, ['provider' => $theirs->uuid]);
        $noSuchFirm = $this->listing($contact, ['provider' => 'not-a-uuid']);
        $this->assertSame($noSuchFirm['total'], $otherFirm['total']);
        $this->assertSame(0, $otherFirm['total']);
    }

    public function test_the_assigned_tab_and_the_table_are_one_list(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $manager = $this->user(Role::ADMINISTRATOR, 'mo@example.com');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $client = Client::create([
            'uid' => 'tm-antoine', 'name' => 'TM Antoine Advisory',
            'data' => [], 'created_by' => $admin->id,
        ]);
        $application = $this->application($provider, $admin);
        $application->forceFill(['client_id' => $client->id])->save();

        ClientAssignment::create([
            'client_id' => $client->id,
            'user_id' => $manager->id,
            'status' => ClientAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);

        /*
         * Somebody added on the profile's Assigned tab is in the table's
         * column, in its filter, and in its count — all three read the one
         * record. When they were separate tables the tab and the table each
         * showed a different answer for the same file.
         */
        $body = $this->listing($admin);

        $this->assertSame(
            'Mo',
            $body['applications'][0]['assignedTo'][0]['name'] ?? null,
            'the column names them',
        );
        $this->assertSame(1, $this->facet($body, 'assignees')[(string) $manager->id] ?? 0);
        $this->assertSame(0, $this->facet($body, 'assignees')[Facets::UNASSIGNED] ?? 0);
        $this->assertSame(1, $this->listing($admin, ['assignee' => (string) $manager->id])['total']);
    }

    public function test_the_facets_do_not_cost_a_query_per_officer(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $one = $this->user(Role::REVIEWING_OFFICER, 'one@example.com');
        $this->putOn($this->application($provider, $admin), $one, $admin);

        DB::enableQueryLog();
        $this->listing($admin);
        $cheap = count(DB::getQueryLog());
        DB::disableQueryLog();

        // Nine more officers, each holding two files.
        foreach (range(2, 10) as $n) {
            $officer = $this->user(Role::REVIEWING_OFFICER, "officer{$n}@example.com");
            $this->putOn($this->application($provider, $admin), $officer, $admin);
            $this->putOn($this->application($provider, $admin), $officer, $admin);
        }

        DB::enableQueryLog();
        DB::flushQueryLog();
        $body = $this->listing($admin);
        $dear = count(DB::getQueryLog());
        DB::disableQueryLog();

        // Ten officers and the unassigned row, which is always offered.
        $this->assertCount(11, $body['assignees'], 'ten officers really are offered');

        /*
         * Not equality. The first listing of the run also warms a cached
         * portal setting, which is two lookups the second one does not repeat
         * — so the cheap run is legitimately the dearer of the two, and
         * pinning them equal would be pinning a cache miss.
         *
         * What matters is that ten times the officers is not ten times the
         * queries. Every query either listing makes is a whereIn over the
         * whole page; the facets add four flat ones — the grouped tally, the
         * names behind it, the unassigned count and the providers — and none
         * of them is per officer.
         */
        $this->assertLessThanOrEqual($cheap, $dear, "One officer cost {$cheap} queries and ten cost {$dear}: "
            .'the facets are being counted an officer at a time.');
        $this->assertLessThanOrEqual(16, $dear, 'the listing has grown a query nobody accounted for');
    }
}
