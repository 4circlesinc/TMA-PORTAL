<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
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

    /** Run $fn with a clean query log and return how many queries it issued. */
    private function countQueries(callable $fn): int
    {
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

    public function test_client_directory_does_not_scale_with_client_count(): void
    {
        $me = $this->staff();
        $this->actingAs($me);

        $addClients = function (int $n, string $prefix) use ($me) {
            for ($i = 0; $i < $n; $i++) {
                \App\Models\Client::create([
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

        $folder = \App\Models\Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Library',
            'owner_id' => $me->id,
            'created_by' => $me->id,
            'folder_type' => \App\Models\Folder::TYPE_ORGANIZATION,
            'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        $addFiles = function (int $count, string $prefix) use ($me, $folder) {
            for ($i = 0; $i < $count; $i++) {
                \App\Models\FileItem::create([
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
                $company = \App\Models\Company::create([
                    'uid' => "$prefix-co-$i",
                    'name' => "$prefix Company $i",
                    'created_by' => $me->id,
                ]);

                // Members and referrals are what the two per-company queries
                // were counting, so both have to exist for the guard to bite.
                \App\Models\CompanyMember::create([
                    'company_id' => $company->id,
                    'name' => "$prefix Member $i",
                    'email' => "$prefix-member-$i@example.com",
                    'status' => \App\Models\CompanyMember::STATUS_ACTIVE,
                    'invited_by' => $me->id,
                ]);

                foreach (range(1, 3) as $n) {
                    \App\Models\Client::create([
                        'uid' => "$prefix-ref-$i-$n",
                        'name' => "$prefix Referred $i $n",
                        'referral_type' => \App\Models\Client::REFERRAL_COMPANY,
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

        $company = \App\Models\Company::create([
            'uid' => 'ties-co',
            'name' => 'Ties Company',
            'created_by' => $me->id,
        ]);

        // Twenty clients sharing one name: more than the preview holds, so
        // which of them it keeps is decided entirely by the sort.
        foreach (range(1, 20) as $n) {
            \App\Models\Client::create([
                'uid' => "tie-$n",
                'name' => 'Same Name',
                'referral_type' => \App\Models\Client::REFERRAL_COMPANY,
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

        $this->assertCount(\App\Models\Company::REFERRED_PREVIEW, $first);
        $this->assertSame($first, $second, 'The referred preview changed between identical requests.');

        // And the single-company path has to agree with the listing, or a
        // company reads one way in the table and another when opened.
        $shown = $this->get('/portal/companies/ties-co')->assertOk()->json('company.referred');
        $this->assertSame($first, $shown, 'show() disagrees with index() about the preview.');
    }
}
