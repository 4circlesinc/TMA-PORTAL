<?php

namespace Tests\Feature;

use App\Models\Group;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Calendar\GroupMembership;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Who counts as staff, everywhere the portal counts them.
 *
 * The officer account type (Role::REVIEWING_OFFICER) arrived after several
 * screens had already written their own `['Administrator', 'Employee']` list,
 * and those screens never learned about it. The team board was the visible
 * symptom: a firm of fifteen people read "10", because the list showed the
 * four administrators and the six accounts still parked on the role-pending
 * screen, and left out every officer actually doing the work.
 *
 * Role::STAFF is the one answer to "who works here". These hold the screens
 * to it, and the last test holds the whole codebase to it.
 */
class StaffHeadcountTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType, array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    public function test_the_team_board_lists_every_account_type_that_works_here(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Officer Onboard']);
        $legacy = $this->user('Reviewing Officer', ['name' => 'Officer Legacy']);
        $parked = $this->user(Role::EMPLOYEE, ['name' => 'Parked Employee']);
        $client = $this->user(Role::CLIENT, ['name' => 'A Client']);

        $ids = collect(
            $this->actingAs($admin)->getJson('/portal/dashboard/staff')->assertOk()->json('employees')
        )->pluck('id');

        $this->assertTrue($ids->contains($officer->id), 'an officer is staff');
        $this->assertTrue($ids->contains($legacy->id), 'a legacy officer spelling is staff');
        $this->assertTrue($ids->contains($admin->id));
        $this->assertTrue($ids->contains($parked->id));
        $this->assertFalse($ids->contains($client->id), 'a client is not on the team board');
        $this->assertCount(4, $ids);
    }

    public function test_an_auto_join_group_counts_the_members_it_actually_has(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->user(Role::REVIEWING_OFFICER);
        $this->user(Role::EMPLOYEE);
        $this->user(Role::CLIENT);

        $group = Group::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Everyone',
            'group_type' => array_key_first(Group::TYPES),
            'auto_join' => true,
            'created_by' => $admin->id,
        ]);

        $reported = collect(
            $this->actingAs($admin)->getJson('/portal/groups')->assertOk()->json('groups')
        )->firstWhere('id', $group->uuid);

        $this->assertSame(
            GroupMembership::usersIn($group)->count(),
            $reported['memberCount'] ?? $reported['members'] ?? null,
            'the count shown must be the membership auto-join resolves to'
        );
    }

    public function test_calendar_staff_search_finds_an_officer(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Findable Officer']);

        $people = $this->actingAs($admin)
            ->getJson('/portal/calendar/discover?q=Findable')
            ->assertOk()
            ->json('people');

        $this->assertSame([$officer->id], collect($people)->pluck('id')->all());
    }

    /**
     * The rule itself: Role owns the account-type lists, nothing else writes
     * one. Every screen that hand-rolled `['Administrator', 'Employee']` was
     * wrong the day the officer type shipped, and silently so — the page still
     * rendered, it just quietly left people out. That exact pair is the
     * signature, so this looks for it and nothing else: the assignable-type
     * dropdowns ('CRO / Reviewing officer' + 'Administrator') are a different,
     * correct list, and are deliberately not caught here.
     */
    public function test_no_file_outside_role_pairs_administrator_with_employee(): void
    {
        $roots = ['app', 'routes', 'database', 'public/js'];
        $allowed = base_path('app/Support/Access/Role.php');
        $offenders = [];

        foreach ($roots as $root) {
            $files = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator(base_path($root), \FilesystemIterator::SKIP_DOTS)
            );

            foreach ($files as $file) {
                if (! in_array($file->getExtension(), ['php', 'js'], true)) {
                    continue;
                }
                if ($file->getPathname() === $allowed) {
                    continue;
                }

                foreach (file($file->getPathname()) as $number => $line) {
                    // Prose about the old list is fine; code that still is it
                    // is not.
                    if (preg_match('#^\s*(//|\*|/\*|\#)#', $line)) {
                        continue;
                    }

                    if (preg_match('/[\'"]Administrator[\'"]/', $line)
                        && preg_match('/[\'"]Employee[\'"]/', $line)) {
                        $offenders[] = $root.'/'.$file->getFilename().':'.($number + 1).' '.trim($line);
                    }
                }
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "Ask App\\Support\\Access\\Role who works here instead:\n".implode("\n", $offenders)
        );
    }
}
