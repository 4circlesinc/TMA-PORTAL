<?php

namespace App\Console\Commands;

use App\Models\CbiApplication;
use App\Support\Cbi\AssigneeDirectory;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CbiNormaliseAssignees extends Command
{
    protected $signature = 'cbi:normalise-assignees
                            {--dry-run : Show who folds into whom without writing anything}';

    protected $description = 'Fold the spellings of each CBI assignee into one person, matched to their portal account where one exists';

    public function handle(): int
    {
        $directory = AssigneeDirectory::build();
        $groups = $directory->groups();

        $rows = [];
        foreach ($groups as $group) {
            $rows[] = [
                $group['canonical'],
                $group['user'] ? $group['user']->email : '—',
                count($group['raw']),
                number_format($group['applications']),
                count($group['raw']) > 1 ? implode(' · ', $group['raw']) : '',
            ];
        }

        $this->table(['Person', 'Account', 'Spellings', 'Files', 'Folded from'], $rows);

        $matched = count(array_filter($groups, fn ($g) => $g['user'] !== null));
        $this->line(sprintf(
            '  %d people from %d spellings; %d matched to an account, %d without one.',
            count($groups),
            array_sum(array_map(fn ($g) => count($g['raw']), $groups)),
            $matched,
            count($groups) - $matched,
        ));

        if ($this->option('dry-run')) {
            $this->warn('Dry run — nothing written.');

            return self::SUCCESS;
        }

        // One UPDATE per person rather than per row: the caseload is eleven
        // thousand applications over a link where every round trip costs, and
        // every row in a group is getting the same two values.
        $updated = 0;
        foreach ($groups as $group) {
            $updated += DB::table('cbi_applications')
                ->whereIn('assigned_to', $group['raw'])
                ->update([
                    'assigned_to_canonical' => $group['canonical'],
                    'assigned_user_id' => $group['user']?->id,
                ]);
        }

        // Values that mean "nobody" should read as unassigned, not as a person
        // called "na".
        $blanked = CbiApplication::query()
            ->whereNotNull('assigned_to')
            ->whereNull('assigned_to_canonical')
            ->update(['assigned_to_canonical' => null, 'assigned_user_id' => null]);

        $this->newLine();
        $this->info(number_format($updated).' applications now point at a canonical assignee.');
        if ($blanked) {
            $this->line('  '.number_format($blanked).' left unassigned (the cell said nothing usable).');
        }

        return self::SUCCESS;
    }
}
