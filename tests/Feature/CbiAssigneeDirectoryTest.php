<?php

namespace Tests\Feature;

use App\Models\CbiApplication;
use App\Models\User;
use App\Support\Cbi\AssigneeDirectory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * One person, one assignee.
 *
 * "Assigned To" is a free-text Smartsheet cell, so the caseload holds forty
 * spellings of nineteen people. These pin the folding rules — and, just as
 * importantly, the cases where folding must refuse.
 */
class CbiAssigneeDirectoryTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $name, string $email): User
    {
        return User::factory()->create([
            'name' => $name,
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
        ]);
    }

    private function assigned(string $to, int $times = 1): void
    {
        for ($i = 0; $i < $times; $i++) {
            CbiApplication::create([
                'dedupe_key' => 'k'.uniqid('', true),
                'applicant_name' => 'Applicant',
                'assigned_to' => $to,
                'stage' => 'applications',
            ]);
        }
    }

    private function groupFor(AssigneeDirectory $d, string $canonical): ?array
    {
        foreach ($d->groups() as $group) {
            if ($group['canonical'] === $canonical) {
                return $group;
            }
        }

        return null;
    }

    public function test_a_first_name_a_full_name_and_an_addressed_name_are_one_person(): void
    {
        $user = $this->staff('Dincel Baptiste', 'dbaptiste@example.com');
        $this->assigned('Dincel', 3);
        $this->assigned('Dincel Baptiste', 2);
        $this->assigned('Dincel Baptiste <dbaptiste@example.com>');

        $directory = AssigneeDirectory::build();

        $this->assertCount(1, $directory->groups());
        $group = $directory->groups()[0];
        $this->assertSame('Dincel Baptiste', $group['canonical']);
        $this->assertSame($user->id, $group['user']->id);
        $this->assertSame(6, $group['applications']);

        // And every spelling resolves to the same answer.
        foreach (['Dincel', 'Dincel Baptiste', 'Dincel Baptiste <dbaptiste@example.com>'] as $raw) {
            $this->assertSame('Dincel Baptiste', $directory->resolve($raw)['name']);
            $this->assertSame($user->id, $directory->resolve($raw)['user']->id);
        }
    }

    public function test_the_full_name_wins_even_when_the_abbreviation_is_commoner(): void
    {
        // 1,198 "Carlos" against 349 "Carlos Labadie" is the real ratio.
        $this->assigned('Carlos', 12);
        $this->assigned('Carlos Labadie', 3);

        $directory = AssigneeDirectory::build();

        $this->assertSame('Carlos Labadie', $directory->groups()[0]['canonical']);
    }

    public function test_a_shared_mailbox_does_not_stop_the_name_finding_its_account(): void
    {
        // One colleague's rows carry a department address that belongs to no
        // person; the name still has to match.
        $user = $this->staff('Mayella Dupres', 'mdupres@example.com');
        $this->assigned('Mayella Dupres <processing@example.com>', 4);
        $this->assigned('Mayella');

        $directory = AssigneeDirectory::build();

        $this->assertSame($user->id, $directory->groups()[0]['user']->id);
        $this->assertSame('Mayella Dupres', $directory->groups()[0]['canonical']);
    }

    public function test_an_ambiguous_first_name_is_left_alone(): void
    {
        // Two colleagues share a first name, so "Maria" cannot be attributed
        // to either. A split workload is visible; a wrong merge is not.
        $this->assigned('Maria', 5);
        $this->assigned('Maria Santos', 2);
        $this->assigned('Maria Lopez', 2);

        $directory = AssigneeDirectory::build();

        $canonicals = array_column($directory->groups(), 'canonical');
        sort($canonicals);
        $this->assertSame(['Maria', 'Maria Lopez', 'Maria Santos'], $canonicals);
    }

    public function test_it_never_invents_an_account(): void
    {
        $this->assigned('Cassie', 3);

        $before = User::count();
        $directory = AssigneeDirectory::build();

        $this->assertNull($directory->groups()[0]['user']);
        $this->assertSame('Cassie', $directory->groups()[0]['canonical']);
        $this->assertSame($before, User::count());
    }

    public function test_a_cell_that_means_nobody_is_not_a_person(): void
    {
        $this->assigned('na');
        $this->assigned('  ');
        $this->assigned('Real Person');

        $directory = AssigneeDirectory::build();

        $this->assertCount(1, $directory->groups());
        $this->assertNull($directory->resolve('na')['name']);
        $this->assertNull($directory->resolve(null)['name']);
    }

    public function test_the_command_writes_the_canonical_name_and_the_account(): void
    {
        $user = $this->staff('Tia Wallace', 'twallace@example.com');
        $this->assigned('Tia Wallace <twallace@example.com>', 2);
        $this->assigned('Tia Wallace');
        $this->assigned('na');

        $this->artisan('cbi:normalise-assignees')->assertExitCode(0);

        $this->assertSame(3, CbiApplication::where('assigned_to_canonical', 'Tia Wallace')->count());
        $this->assertSame(3, CbiApplication::where('assigned_user_id', $user->id)->count());
        $this->assertNull(CbiApplication::where('assigned_to', 'na')->first()->assigned_to_canonical);
    }

    public function test_a_dry_run_writes_nothing(): void
    {
        $this->staff('Tia Wallace', 'twallace@example.com');
        $this->assigned('Tia Wallace');

        $this->artisan('cbi:normalise-assignees', ['--dry-run' => true])->assertExitCode(0);

        $this->assertNull(CbiApplication::first()->assigned_to_canonical);
        $this->assertNull(CbiApplication::first()->assigned_user_id);
    }
}
