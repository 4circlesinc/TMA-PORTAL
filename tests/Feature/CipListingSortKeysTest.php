<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The browser sorts a one-page lane itself, from keys the server writes on
 * each row. That is only honest if sorting by those keys gives the SAME
 * order the server gives for the same column - one definition of ordering,
 * written in two places, checked here to agree.
 *
 * The comparator below is the browser's, transcribed: nulls last whichever
 * way the arrow points, then the key, then the order the rows arrived in.
 */
class CipListingSortKeysTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function staff(): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => 'ada-sortkeys@example.com', 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function provider(User $owner, string $name, string $code): CipProvider
    {
        $company = Company::create(['uid' => 'co-'.$code, 'name' => $name, 'created_by' => $owner->id]);

        return CipProvider::create(['name' => $name, 'code' => $code, 'company_id' => $company->id]);
    }

    private function application(User $staff, CipProvider $provider, string $first, string $last, string $status, ?string $submitted, string $investment): CipApplication
    {
        $application = Applications::create($provider, $staff, [
            'investment_type' => $investment,
            'sponsored' => false,
        ]);
        $application->forceFill(['status' => $status, 'submitted_at' => $submitted])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => $first,
            'last_name' => $last,
            'date_of_birth' => '1990-01-01',
        ]);

        return $application;
    }

    /**
     * The browser's comparator, in PHP.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<string>
     */
    private function browserOrder(array $rows, string $key, string $dir): array
    {
        $indexed = array_map(fn ($row, $i) => ['a' => $row, 'i' => $i], $rows, array_keys($rows));
        $desc = $dir === 'desc';

        usort($indexed, function ($x, $y) use ($key, $desc) {
            $kx = $x['a']['sortKeys'][$key] ?? null;
            $ky = $y['a']['sortKeys'][$key] ?? null;
            $nx = $kx === null;
            $ny = $ky === null;
            if ($nx !== $ny) {
                return $nx ? 1 : -1;
            }
            if (! $nx && $kx !== $ky) {
                $c = $kx < $ky ? -1 : 1;

                return $desc ? -$c : $c;
            }

            return $x['i'] <=> $y['i'];
        });

        return array_map(fn ($x) => $x['a']['id'], $indexed);
    }

    public function test_sorting_by_the_row_keys_matches_the_server_for_every_column(): void
    {
        $staff = $this->staff();
        $galaxy = $this->provider($staff, 'Galaxy', 'GAL');
        $aurora = $this->provider($staff, 'Aurora', 'AUR');

        // Deliberately mixed: names out of id order, a status later in the
        // lifecycle on an earlier row, a missing submitted date, two
        // investment types whose form order is not alphabetical.
        $this->application($staff, $galaxy, 'Zed', 'Zane', Status::NEW, '2026-03-01', 'real_estate');
        $this->application($staff, $aurora, 'Ada', 'Able', Status::GRANTED, null, 'other');
        $this->application($staff, $galaxy, 'Mia', 'Moss', Status::NEW, '2026-01-15', 'national_economic_fund');
        $this->application($staff, $aurora, 'Bob', 'Byrne', Status::GRANTED, '2026-02-10', 'real_estate');

        $this->actingAs($staff);

        // As the browser fetches: no sort, one page, keys on every row.
        $unsorted = $this->getJson('/portal/cip/applications?perPage=150')->assertOk()->json();
        $this->assertSame(1, $unsorted['lastPage']);
        foreach ($unsorted['applications'] as $row) {
            $this->assertArrayHasKey('sortKeys', $row);
        }

        foreach (['number', 'applicant', 'submitted', 'provider', 'investment', 'status', 'family', 'contact'] as $column) {
            foreach (['asc', 'desc'] as $dir) {
                $server = array_column(
                    $this->getJson('/portal/cip/applications?perPage=150&sort='.$column.'&dir='.$dir)
                        ->assertOk()
                        ->json('applications'),
                    'id',
                );

                $this->assertSame(
                    $server,
                    $this->browserOrder($unsorted['applications'], $column, $dir),
                    "Sorting by {$column} {$dir} in the browser disagrees with the server.",
                );
            }
        }
    }

    public function test_a_missing_value_sorts_last_in_both_directions(): void
    {
        $staff = $this->staff();
        $galaxy = $this->provider($staff, 'Galaxy', 'GAL');

        $dated = $this->application($staff, $galaxy, 'Ada', 'Able', Status::NEW, '2026-02-01', 'real_estate');
        $undated = $this->application($staff, $galaxy, 'Bob', 'Byrne', Status::NEW, null, 'real_estate');

        $this->actingAs($staff);
        $rows = $this->getJson('/portal/cip/applications?perPage=150')->assertOk()->json('applications');

        foreach (['asc', 'desc'] as $dir) {
            $order = $this->browserOrder($rows, 'submitted', $dir);
            $this->assertSame($undated->uuid, end($order), "An undated row must sort last ({$dir}).");
            $this->assertSame($dated->uuid, $order[0]);
        }
    }

    public function test_status_keys_follow_the_lifecycle_and_draft_sits_with_new(): void
    {
        $staff = $this->staff();
        $galaxy = $this->provider($staff, 'Galaxy', 'GAL');

        $this->application($staff, $galaxy, 'Ada', 'Able', Status::GRANTED, '2026-02-01', 'real_estate');
        $this->application($staff, $galaxy, 'Bob', 'Byrne', Status::NEW, '2026-02-01', 'real_estate');
        $this->application($staff, $galaxy, 'Cy', 'Cole', Status::DRAFT, '2026-02-01', 'real_estate');

        $this->actingAs($staff);
        $rows = collect($this->getJson('/portal/cip/applications?perPage=150')->assertOk()->json('applications'))
            ->keyBy('status');

        $new = $rows[Status::NEW]['sortKeys']['status'];
        $this->assertSame($new, $rows[Status::DRAFT]['sortKeys']['status'], 'Draft sorts alongside New, as the server orders it.');
        $this->assertGreaterThan($new, $rows[Status::GRANTED]['sortKeys']['status'], 'Approved comes after New in the lifecycle.');
    }
}
