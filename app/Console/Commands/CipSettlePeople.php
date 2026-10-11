<?php

namespace App\Console\Commands;

use App\Models\CipApplication;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Settlement;
use Illuminate\Console\Command;

/**
 * Put every person on a post-approval application where the rules say
 * they stand.
 *
 * A person's status is read off the application, their own documents and
 * the steps recorded for them alone ({@see PersonStatus}), and is settled
 * whenever any of those changes and again each time the file is opened.
 * This does the same for every post-approval file at once, and walks a
 * file still standing at Approved to where its documents put it
 * ({@see Settlement}): after a change to the rules, or to be sure nothing
 * is left on a status its checklist no longer supports.
 *
 * Writes only where the answer has changed, so it is safe to run twice and
 * a second run reports nothing.
 */
class CipSettlePeople extends Command
{
    protected $signature = 'cip:settle-people';

    protected $description = 'Settle every person on a post-approval application onto the status the application and their documents put them on';

    public function handle(): int
    {
        $done = Settlement::everyPostApprovalFile(function (CipApplication $application, int $people, bool $moved) {
            if ($people === 0 && ! $moved) {
                return;
            }

            $this->line($application->displayNumber().': '.$people.' settled'
                .($moved ? ', application moved to '.\App\Support\Cip\Status::label($application->fresh()->status) : ''));
        });

        $this->info($done['files'].' post-approval applications read, '.$done['people'].' people settled, '
            .$done['moved'].' applications moved.');

        if ($done['failed'] > 0) {
            $this->warn($done['failed'].' could not be read; see the log.');
        }

        return self::SUCCESS;
    }
}
