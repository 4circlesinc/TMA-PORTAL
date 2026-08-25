<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Models\UserPresence;
use App\Support\Files\FileAccess;
use App\Support\Presence\AvailabilityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Query-count guards for the portal's list endpoints.
 *
 * A list endpoint should cost a fixed number of queries no matter how many rows
 * it returns. When it doesn't, the page is slow in proportion to how much data
 * the user has — which reads on the client as the interface hanging or
 * reloading, and is the half of "the portal feels unstable" that no amount of
 * frontend work can fix.
 *
 * Each test seeds a small set, records the query count, seeds a larger set, and
 * asserts the count did not grow. That catches an N+1 by its shape rather than
 * by pinning an exact number, so the tests survive ordinary query changes.
 */
class QueryCountTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        $u = User::create([
            'name' => 'Query Probe',
            'email' => 'probe@example.com',
            'password' => Hash::make('password12345'),
        ]);

        $u->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    /**
     * Run $fn with a clean query log and return how many queries it issued.
     *
     * The per-request static caches are dropped first, because a real request
     * begins with all of them empty. PHPUnit runs the whole suite in one
     * process, so without this a listing measured here can be answered partly
     * from rows a completely unrelated test happened to warm — which is not a
     * smaller number, it is a wrong one. Two of the tests below silently
     * stopped detecting a live N+1 that way.
     */
    private function countQueries(callable $fn): int
    {
        FileAccess::forgetFolders();
        AvailabilityService::forgetPrimedStates();

        DB::flushQueryLog();
        DB::enableQueryLog();

        $fn();

        $n = count(DB::getQueryLog());
        DB::disableQueryLog();
        DB::flushQueryLog();

        return $n;
    }

    private function seedConversations(User $me, int $count, int $messagesEach, string $prefix): void
    {
        for ($i = 0; $i < $count; $i++) {
            $other = User::create([
                'name' => "$prefix Person $i",
                'email' => "$prefix-$i@example.com",
                'password' => Hash::make('password12345'),
            ]);

            $c = Conversation::create([
                'type' => 'direct',
                'created_by' => $me->id,
                'last_message_at' => now()->subMinutes($i),
            ]);

            foreach ([$me, $other] as $m) {
                $c->participants()->create([
                    'user_id' => $m->id,
                    'role' => 'member',
                    'joined_at' => now(),
                ]);
            }

            for ($n = 0; $n < $messagesEach; $n++) {
                $c->messages()->create([
                    'user_id' => $n % 2 ? $me->id : $other->id,
                    'type' => 'text',
                    'body' => "Message $n",
                ]);
            }
        }
    }

    public function test_conversation_list_does_not_scale_with_conversation_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $this->seedConversations($me, 3, 2, 'small');
        $small = $this->countQueries(function () {
            $this->get('/portal/messaging/conversations')->assertOk();
        });

        $this->seedConversations($me, 12, 2, 'large');
        $large = $this->countQueries(function () {
            $this->get('/portal/messaging/conversations')->assertOk();
        });

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Conversation list is N+1: $small queries for 3 conversations, $large for 15."
        );
    }

    public function test_message_thread_does_not_scale_with_message_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $this->seedConversations($me, 1, 3, 'thin');
        $thin = Conversation::first();
        $small = $this->countQueries(function () use ($thin) {
            $this->get("/portal/messaging/conversations/{$thin->uuid}/messages")->assertOk();
        });

        $this->seedConversations($me, 1, 40, 'fat');
        $fat = Conversation::latest('id')->first();
        $large = $this->countQueries(function () use ($fat) {
            $this->get("/portal/messaging/conversations/{$fat->uuid}/messages")->assertOk();
        });

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Message thread is N+1: $small queries for 3 messages, $large for 40."
        );
    }

    public function test_file_browse_does_not_scale_with_file_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Probe',
            'owner_id' => $me->id,
            'created_by' => $me->id,
        ]);

        $addFiles = function (int $n, string $prefix) use ($me, $folder) {
            for ($i = 0; $i < $n; $i++) {
                FileItem::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => "$prefix-$i.pdf",
                    'extension' => 'pdf',
                    'mime_type' => 'application/pdf',
                    'size' => 100,
                    'disk' => 'local',
                    'storage_path' => 'vault/x.pdf',
                    'folder_id' => $folder->id,
                    'owner_id' => $me->id,
                    'uploaded_by' => $me->id,
                ]);
            }
        };

        $addFiles(3, 'small');
        $small = $this->countQueries(function () {
            $this->get('/portal/files/?section=all')->assertOk();
        });

        $addFiles(25, 'large');
        $large = $this->countQueries(function () {
            $this->get('/portal/files/?section=all')->assertOk();
        });

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "File browse is N+1: $small queries for 3 files, $large for 28."
        );
    }

    /*
     * The two above list a folder from OUTSIDE it, which in a folder-first
     * listing means they measure the folder row and never its contents — so
     * both stayed green through the worst N+1 the File Library has had. These
     * two open the folder, which is what a person actually does.
     *
     * What was wrong, measured against the firm's real library (Aug 2026):
     * every primed map is sparse, holding only the rows that HAVE a share, a
     * colour preference, a CIP slot. `$map[$id] ?? <lazy lookup>` read a
     * missing key as "not primed" rather than "primed, and this row has none",
     * so the fallback fired on nearly every row; the §17 package check
     * lazy-loaded a CIP slot five more times per row on top. Fifty files cost
     * 364 queries and 104 seconds, and the folder with eleven thousand clients
     * in it never returned at all.
     */
    public function test_browsing_inside_a_folder_does_not_scale_with_file_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Inside',
            'owner_id' => $me->id,
            'created_by' => $me->id,
        ]);

        $addFiles = function (int $n, string $prefix) use ($me, $folder) {
            for ($i = 0; $i < $n; $i++) {
                FileItem::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => "$prefix-$i.pdf",
                    'extension' => 'pdf',
                    'mime_type' => 'application/pdf',
                    'size' => 100,
                    'disk' => 'local',
                    'storage_path' => 'vault/x.pdf',
                    'folder_id' => $folder->id,
                    'owner_id' => $me->id,
                    'uploaded_by' => $me->id,
                ]);
            }
        };

        $browse = fn () => $this->get("/portal/files/?section=all&folder={$folder->uuid}")->assertOk();

        $addFiles(3, 'small');
        $small = $this->countQueries($browse);

        $addFiles(25, 'large');
        $large = $this->countQueries($browse);

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Browsing a folder is N+1: $small queries for 3 files, $large for 28."
        );
    }

    public function test_browsing_inside_a_folder_does_not_scale_with_subfolder_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $root = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Clients',
            'owner_id' => $me->id,
            'created_by' => $me->id,
            'folder_type' => Folder::TYPE_ROOT,
        ]);

        $addFolders = function (int $n, string $prefix) use ($me, $root) {
            for ($i = 0; $i < $n; $i++) {
                Folder::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => "$prefix Client $i",
                    'parent_id' => $root->id,
                    'owner_id' => $me->id,
                    'created_by' => $me->id,
                    'folder_type' => Folder::TYPE_CLIENT,
                ]);
            }
        };

        $browse = fn () => $this->get("/portal/files/?section=all&folder={$root->uuid}")->assertOk();

        $addFolders(3, 'small');
        $small = $this->countQueries($browse);

        $addFolders(25, 'large');
        $large = $this->countQueries($browse);

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Listing subfolders is N+1: $small queries for 3 folders, $large for 28."
        );
    }

    /*
     * The Dashboard's Employees card.
     *
     * Availability was resolved one person at a time, and resolving it cost
     * four queries a head: two purge deletes, the layered states, and a
     * re-read of the presence row we had just written. Thirteen colleagues
     * meant fifty-two round trips and ten seconds — for a card of faces.
     */
    public function test_staff_presence_does_not_scale_with_staff_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $addStaff = function (int $n, string $prefix) {
            for ($i = 0; $i < $n; $i++) {
                $u = User::create([
                    'name' => "$prefix Colleague $i",
                    'email' => "$prefix-staff-$i@example.com",
                    'password' => Hash::make('password12345'),
                ]);
                $u->forceFill([
                    'status' => 'approved',
                    'account_type' => 'Employee',
                    'email_verified_at' => now(),
                ])->save();
                /*
                 * The presence row is what makes this test bite. Availability
                 * is only resolved for somebody who has one, and anyone who
                 * has ever loaded the portal does — so without this the card
                 * takes the cheap path here and the expensive one in real life,
                 * which is exactly how the N+1 shipped.
                 */
                UserPresence::create([
                    'user_id' => $u->id,
                    'last_seen_at' => now()->subMinutes(5),
                ]);
            }
        };

        /*
         * Read once before counting. The first read of a brand-new presence
         * row settles its primary status and writes it back — a real cost, but
         * a one-off, and in the firm's database every row settled long ago.
         * Counting the first read would measure the seed, not the card.
         */
        $read = function () {
            $this->get('/portal/dashboard/staff')->assertOk();
        };

        $addStaff(3, 'small');
        $read();
        $small = $this->countQueries($read);

        $addStaff(25, 'large');
        $read();
        $large = $this->countQueries($read);

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Staff presence is N+1: $small queries for 4 people, $large for 29."
        );
    }

    public function test_client_directory_does_not_scale_with_client_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $addClients = function (int $n, string $prefix) use ($me) {
            for ($i = 0; $i < $n; $i++) {
                Client::create([
                    'uid' => (string) Str::uuid(),
                    'name' => "$prefix Client $i",
                    'email' => "$prefix-client-$i@example.com",
                    'data' => [],
                    'created_by' => $me->id,
                ]);
            }
        };

        $addClients(3, 'small');
        $small = $this->countQueries(function () {
            $this->get('/portal/clients')->assertOk();
        });

        $addClients(25, 'large');
        $large = $this->countQueries(function () {
            $this->get('/portal/clients')->assertOk();
        });

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Client directory is N+1: $small queries for 3 clients, $large for 28."
        );
    }

    /*
     * As above, but inside a folder granted to all staff — the case the plain
     * browse test does not reach.
     *
     * Those rows resolve who they are shared with: the people the grant covers,
     * and how many that is. Both are the same answer for every row, so they are
     * built once per listing; asked per file they would be two more queries on
     * each of forty thousand.
     */
    public function test_file_list_with_a_firm_wide_grant_does_not_scale(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Library',
            'owner_id' => $me->id,
            'created_by' => $me->id,
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        $addFiles = function (int $count, string $prefix) use ($me, $folder) {
            for ($i = 0; $i < $count; $i++) {
                FileItem::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => "$prefix-$i.pdf",
                    'extension' => 'pdf',
                    'mime_type' => 'application/pdf',
                    'size' => 1,
                    'disk' => 'local',
                    'storage_path' => "vault/$prefix-$i.pdf",
                    'folder_id' => $folder->id,
                    'owner_id' => $me->id,
                    'uploaded_by' => $me->id,
                ]);
            }
        };

        $addFiles(3, 'small');
        $small = $this->countQueries(function () {
            $this->get('/portal/files/')->assertOk();
        });

        $addFiles(25, 'large');
        $large = $this->countQueries(function () {
            $this->get('/portal/files/')->assertOk();
        });

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "File listing is N+1: $small queries for 3 files, $large for 28."
        );
    }

    /*
     * The companies listing cost two queries per company: one for memberCount,
     * one for the twelve-client `referred` preview that Eloquent cannot eager
     * load. Sixty-four companies meant a hundred and thirty queries and forty
     * seconds — on the same page load as the client directory, so the Client
     * hub waited for it whatever else was fixed.
     */
    public function test_company_list_does_not_scale_with_company_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $addCompanies = function (int $count, string $prefix) use ($me) {
            for ($i = 0; $i < $count; $i++) {
                $company = Company::create([
                    'uid' => "$prefix-co-$i",
                    'name' => "$prefix Company $i",
                    'created_by' => $me->id,
                ]);

                // Members and referrals are what the two per-company queries
                // were counting, so both have to exist for the guard to bite.
                CompanyMember::create([
                    'company_id' => $company->id,
                    'name' => "$prefix Member $i",
                    'email' => "$prefix-member-$i@example.com",
                    'status' => CompanyMember::STATUS_ACTIVE,
                    'invited_by' => $me->id,
                ]);

                foreach (range(1, 3) as $n) {
                    Client::create([
                        'uid' => "$prefix-ref-$i-$n",
                        'name' => "$prefix Referred $i $n",
                        'referral_type' => Client::REFERRAL_COMPANY,
                        'referred_by_company_id' => $company->id,
                        'data' => [],
                        'created_by' => $me->id,
                    ]);
                }
            }
        };

        $addCompanies(3, 'small');
        $small = $this->countQueries(function () {
            $this->get('/portal/companies')->assertOk();
        });

        $addCompanies(25, 'large');
        $large = $this->countQueries(function () {
            $this->get('/portal/companies')->assertOk();
        });

        $this->assertLessThanOrEqual(
            $small + 2,
            $large,
            "Company list is N+1: $small queries for 3 companies, $large for 28."
        );
    }

    /*
     * The `referred` preview is built by ranking in the database rather than by
     * a query per company, which means its tie-breaking is this code's problem
     * rather than the planner's. The caseload is full of repeated names — one
     * referrer has 188 that appear more than once — so without a stable second
     * sort key the same company could show a different twelve on each request.
     */
    public function test_referred_preview_is_stable_when_names_repeat(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $company = Company::create([
            'uid' => 'ties-co',
            'name' => 'Ties Company',
            'created_by' => $me->id,
        ]);

        // Twenty clients sharing one name: more than the preview holds, so
        // which of them it keeps is decided entirely by the sort.
        foreach (range(1, 20) as $n) {
            Client::create([
                'uid' => "tie-$n",
                'name' => 'Same Name',
                'referral_type' => Client::REFERRAL_COMPANY,
                'referred_by_company_id' => $company->id,
                'data' => [],
                'created_by' => $me->id,
            ]);
        }

        $idsFromListing = function () {
            $body = $this->get('/portal/companies')->assertOk()->json('companies');

            return collect($body)->firstWhere('id', 'ties-co')['referred'];
        };

        $first = $idsFromListing();
        $second = $idsFromListing();

        $this->assertCount(Company::REFERRED_PREVIEW, $first);
        $this->assertSame($first, $second, 'The referred preview changed between identical requests.');

        // And the single-company path has to agree with the listing, or a
        // company reads one way in the table and another when opened.
        $shown = $this->get('/portal/companies/ties-co')->assertOk()->json('company.referred');
        $this->assertSame($first, $shown, 'show() disagrees with index() about the preview.');
    }
}
