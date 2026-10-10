<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A page of the applications table must cost a fixed number of queries.
 *
 * The table is asked for 150 rows at a time. Anything measured per row is
 * invisible on the seed data and three hundred round trips on the firm's
 * real list, so the count is asserted here rather than discovered in
 * production. This is a guard, not a benchmark: it counts queries, which is
 * what stays true regardless of the machine running it.
 */
class CipListingScaleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function staff(): User
    {
        $u = User::create([
            'name' => 'Ada Admin',
            'email' => 'ada-scale@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function provider(User $owner): CipProvider
    {
        $company = Company::create(['uid' => 'galaxy-scale', 'name' => 'Galaxy', 'created_by' => $owner->id]);

        return CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
    }

    /** @return list<CipApplication> */
    private function applications(User $staff, CipProvider $provider, int $count, string $phase): array
    {
        $made = [];

        for ($i = 0; $i < $count; $i++) {
            $application = Applications::create($provider, $staff, [
                'investment_type' => 'real_estate',
                'sponsored' => false,
            ]);
            $application->forceFill([
                'phase' => $phase,
                'status' => Status::NEW,
                'submitted_at' => now()->subDays($i),
            ])->save();

            CipPerson::create([
                'application_id' => $application->id,
                'role' => CipPerson::ROLE_MAIN_APPLICANT,
                'first_name' => 'Applicant'.$i,
                'last_name' => 'Row',
                'date_of_birth' => '1990-01-01',
            ]);

            $made[] = $application;
        }

        return $made;
    }

    /** @return array{count:int, queries:list<string>} */
    private function measure(callable $fn): array
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $fn();
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        return [
            'count' => count($log),
            'queries' => array_map(fn ($q) => $q['query'], $log),
        ];
    }

    /**
     * The query shapes a listing repeats, and how often.
     *
     * Counting queries alone is the wrong test: some of the fixed cost is
     * data-dependent (the attention dots only ask their questions once some
     * client has unread activity), so a page of ten legitimately differs from
     * a page of five for reasons that have nothing to do with rows. What must
     * never happen is the SAME query shape running once per row — that is the
     * thing that turns 150 rows into 150 round trips.
     *
     * Bind values are stripped so `in (?, ?)` and `in (?, ?, ?)` are one
     * shape, and `where id = ?` repeated per row is caught as one shape
     * running many times.
     *
     * @param  list<string>  $queries
     * @return array<string, int>
     */
    private function repeats(array $queries): array
    {
        $shapes = [];

        foreach ($queries as $query) {
            $shape = preg_replace('/\s+/', ' ', trim($query));
            // Any bind list collapses to one placeholder.
            $shape = preg_replace('/\((\s*\?\s*,)+\s*\?\s*\)/', '(?)', $shape);
            $shapes[$shape] = ($shapes[$shape] ?? 0) + 1;
        }

        /*
         * Settings are read by several unrelated callers in one request and
         * memoised per caller, not globally. That is a small fixed cost, the
         * same whether the page holds ten rows or a hundred and fifty, so it
         * is not what this guard is about — counting it here would fail the
         * test for something that does not scale.
         */
        unset($shapes['select * from "portal_settings" where "key" = ? limit 1']);

        return array_filter($shapes, fn (int $n) => $n > 1);
    }

    public function test_a_page_of_the_table_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->applications($staff, $provider, 10, Phase::PRE_APPROVAL);

        $this->actingAs($staff);

        $large = $this->measure(function () {
            $this->getJson('/portal/cip/applications?perPage=10')->assertOk();
        });

        $repeats = $this->repeats($large['queries']);

        $this->assertSame(
            [],
            $repeats,
            "A query shape ran more than once for a page of ten rows:\n".
            implode("\n", array_map(
                fn (string $shape, int $n) => $n.'x  '.substr($shape, 0, 160),
                array_keys($repeats),
                $repeats,
            )),
        );
    }

    public function test_sorting_the_table_costs_no_extra_queries(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->applications($staff, $provider, 10, Phase::PRE_APPROVAL);

        $this->actingAs($staff);

        foreach (['number', 'applicant', 'submitted', 'provider', 'status'] as $sort) {
            $sorted = $this->measure(function () use ($sort) {
                $this->getJson('/portal/cip/applications?perPage=10&sort='.$sort.'&dir=asc')->assertOk();
            });

            $this->assertSame(
                [],
                $this->repeats($sorted['queries']),
                'Sorting by '.$sort.' repeated a query shape, so the sort is measured per row.',
            );
        }
    }

    public function test_the_post_approval_tab_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $applications = $this->applications($staff, $provider, 10, Phase::POST_APPROVAL);

        // A family each: post-approval rows expand, so they carry every person.
        foreach ($applications as $application) {
            foreach ([CipPerson::ROLE_SPONSOR, CipPerson::ROLE_DEPENDENT] as $i => $role) {
                CipPerson::create([
                    'application_id' => $application->id,
                    'role' => $role,
                    'first_name' => 'Rel'.$i,
                    'last_name' => 'Row',
                    'date_of_birth' => '1995-01-01',
                    'dependent_ordinal' => $role === CipPerson::ROLE_DEPENDENT ? 1 : null,
                ]);
            }
        }

        /*
         * Every person with a passport photo FILED - a real file behind the
         * slot, not just the slot. The expandable row draws each member's
         * face off that file, and a fixture without one never exercised the
         * walk that cost the production list one query per person.
         */
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Photos',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_CLIENT,
        ]);
        foreach ($applications as $application) {
            foreach ($application->people()->get() as $person) {
                $file = FileItem::create([
                    'uuid' => (string) Str::uuid(),
                    'folder_id' => $folder->id,
                    'owner_id' => $staff->id,
                    'name' => 'photo-'.$person->id.'.jpg',
                    'extension' => 'jpg',
                    'mime_type' => 'image/jpeg',
                    'size' => 2048,
                    'disk' => 'local',
                    'storage_path' => 'tests/photo-'.$person->id.'.jpg',
                ]);
                CipDocument::create([
                    'uuid' => (string) Str::uuid(),
                    'application_id' => $application->id,
                    'person_id' => $person->id,
                    'type' => DocumentTypes::PASSPORT_PHOTO,
                    'label' => 'Passport photo',
                    'required' => true,
                    'file_id' => $file->id,
                ]);
            }
        }

        $this->actingAs($staff);

        $large = $this->measure(function () {
            $this->getJson('/portal/cip/applications?phase='.Phase::POST_APPROVAL.'&perPage=10')->assertOk();
        });

        $repeats = $this->repeats($large['queries']);

        $this->assertSame(
            [],
            $repeats,
            "The post-approval tab repeated a query shape, so something is measured per row:\n".
            implode("\n", array_map(
                fn (string $shape, int $n) => $n.'x  '.substr($shape, 0, 160),
                array_keys($repeats),
                $repeats,
            )),
        );
    }

    /*
     * The same families, on the tab that does not name a lane.
     *
     * All Applications holds post-approval files alongside the others, and a
     * row draws its family from its OWN phase, not from the filter. The eager
     * load was read off the request instead, so this page - the one a reader
     * lands on - skipped it and walked to the database once per member: 118
     * document reads and 58 file reads to draw 68 rows on the production
     * snapshot, against 24 queries for the same rows under the post-approval
     * filter. The guard above could not see it because it always named a lane.
     */
    public function test_the_unfiltered_tab_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $applications = $this->applications($staff, $provider, 10, Phase::POST_APPROVAL);

        foreach ($applications as $application) {
            foreach ([CipPerson::ROLE_SPONSOR, CipPerson::ROLE_DEPENDENT] as $i => $role) {
                CipPerson::create([
                    'application_id' => $application->id,
                    'role' => $role,
                    'first_name' => 'Rel'.$i,
                    'last_name' => 'Row',
                    'date_of_birth' => '1995-01-01',
                    'dependent_ordinal' => $role === CipPerson::ROLE_DEPENDENT ? 1 : null,
                ]);
            }
        }

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Unfiltered scale photos',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_CLIENT,
        ]);

        foreach ($applications as $application) {
            foreach ($application->people()->get() as $person) {
                $file = FileItem::create([
                    'uuid' => (string) Str::uuid(),
                    'folder_id' => $folder->id,
                    'owner_id' => $staff->id,
                    'name' => 'photo-'.$person->id.'.jpg',
                    'extension' => 'jpg',
                    'mime_type' => 'image/jpeg',
                    'size' => 2048,
                    'disk' => 'local',
                    'storage_path' => 'tests/unfiltered-photo-'.$person->id.'.jpg',
                ]);
                CipDocument::create([
                    'uuid' => (string) Str::uuid(),
                    'application_id' => $application->id,
                    'person_id' => $person->id,
                    'type' => DocumentTypes::PASSPORT_PHOTO,
                    'label' => 'Passport photo',
                    'required' => true,
                    'file_id' => $file->id,
                ]);
            }
        }

        $this->actingAs($staff);

        // No phase: the tab the reader lands on.
        $unfiltered = $this->measure(function () {
            $this->getJson('/portal/cip/applications?perPage=10')->assertOk();
        });

        $repeats = $this->repeats($unfiltered['queries']);

        $this->assertSame(
            [],
            $repeats,
            "All Applications repeated a query shape, so something is measured per row:\n".
            implode("\n", array_map(
                fn (string $shape, int $n) => $n.'x  '.substr($shape, 0, 160),
                array_keys($repeats),
                $repeats,
            )),
        );
    }

    /*
     * The page reads what its rows draw, and no more.
     *
     * The guards above count query shapes, and by that measure loading every
     * document of every person on the page is perfect: it is two queries
     * whatever the page holds. It was also sixteen thousand documents and
     * eleven thousand files to draw eighty-five lines on All Applications,
     * twenty times the cost of the Pre-Approval tab, because a family row is
     * only drawn for a post-approval file and reads one file per person.
     * So this one counts what was loaded, not how many times it was asked.
     */
    public function test_the_unfiltered_tab_loads_only_the_documents_its_family_rows_draw(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $pre = $this->applications($staff, $provider, 4, Phase::PRE_APPROVAL);
        $post = $this->applications($staff, $provider, 2, Phase::POST_APPROVAL);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Loaded scale papers',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_CLIENT,
        ]);

        $file = fn (string $name) => FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder->id,
            'owner_id' => $staff->id,
            'name' => $name,
            'extension' => 'jpg',
            'mime_type' => 'image/jpeg',
            'size' => 2048,
            'disk' => 'local',
            'storage_path' => 'tests/loaded-'.$name,
        ]);

        // In both lanes, every person: a photo, a second paper that is filed,
        // and a third that is not.
        foreach (array_merge($pre, $post) as $application) {
            CipPerson::create([
                'application_id' => $application->id,
                'role' => CipPerson::ROLE_DEPENDENT,
                'first_name' => 'Child',
                'last_name' => 'Row',
                'date_of_birth' => '2015-01-01',
                'dependent_ordinal' => 1,
            ]);

            foreach ($application->people()->get() as $person) {
                foreach ([
                    [DocumentTypes::PASSPORT_PHOTO, true],
                    ['birth_certificate', true],
                    ['police_certificate', false],
                ] as [$type, $filed]) {
                    CipDocument::create([
                        'uuid' => (string) Str::uuid(),
                        'application_id' => $application->id,
                        'person_id' => $person->id,
                        'type' => $type,
                        'label' => $type,
                        'required' => true,
                        'file_id' => $filed ? $file($type.'-'.$person->id.'.jpg')->id : null,
                    ]);
                }
            }
        }

        $this->actingAs($staff);

        // Rows that are a document or a file, as opposed to the grouped
        // counts the checklist tally reads through the same model.
        $documents = 0;
        $files = 0;
        CipDocument::retrieved(function (CipDocument $slot) use (&$documents) {
            $documents += $slot->getKey() === null ? 0 : 1;
        });
        FileItem::retrieved(function (FileItem $file) use (&$files) {
            $files += $file->getKey() === null ? 0 : 1;
        });

        $rows = collect(
            $this->getJson('/portal/cip/applications?perPage=150')->assertOk()->json('applications')
        )->keyBy('id');

        // Two post-approval files of two people: three slots each, and the one
        // file a row can show. Not the thirty-six slots and twenty-four files
        // the twelve people on the page hold between them.
        $this->assertSame(12, $documents, 'The page loaded documents for people whose rows do not draw them.');
        $this->assertSame(4, $files, 'The page loaded files other than the passport photos it draws.');

        // And the rows still say what they said.
        $this->assertSame([], $rows[$pre[0]->uuid]['familyMembers']);

        $family = $rows[$post[0]->uuid]['familyMembers'];
        $this->assertCount(2, $family);

        foreach ($family as $member) {
            $this->assertSame(3, $member['docTotal']);
            $this->assertSame(2, $member['docFiled']);
            $this->assertSame(1, $member['docPending']);
            $this->assertStringContainsString('/portal/files/', (string) $member['photo']);
            $this->assertStringContainsString('/portal/files/', (string) $member['passportPhotoUrl']);
        }
    }

    public function test_a_sort_or_page_change_does_not_recount_the_whole_table(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $this->applications($staff, $provider, 10, Phase::PRE_APPROVAL);

        $this->actingAs($staff);

        // First draw: the filter menu and the tab badges have to be measured.
        $first = $this->measure(function () {
            $this->getJson('/portal/cip/applications?perPage=10&facets=1')->assertOk();
        });

        // Clicking a column header cannot change a count taken over the whole
        // slice, so the aggregates behind the menu must not be asked again.
        $resort = $this->measure(function () {
            $this->getJson('/portal/cip/applications?perPage=10&sort=applicant&dir=asc')->assertOk();
        });

        $this->assertLessThan(
            $first['count'],
            $resort['count'],
            'Re-sorting cost as much as the first draw, so the whole-table counts are being recomputed.',
        );
    }
}
