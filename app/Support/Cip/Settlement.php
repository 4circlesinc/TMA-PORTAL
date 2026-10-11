<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * One pass over every post-approval file: the people on it settled, and a
 * file the old rules left stranded walked to where its documents put it.
 *
 * Day to day nothing needs this. {@see PersonStatus::settle()} runs
 * wherever a person's answer can change, and {@see Review::settle()} walks
 * the file on every document verdict. This is for the day the rules
 * themselves change, the deploy migration, and for `cip:settle-people`.
 */
class Settlement
{
    /**
     * The checklist may have changed without a document being judged.
     *
     * Opening a file materialises its checklist, and so does editing it: a
     * requirement an administrator added since, or a dependant added on Edit
     * application, arrives as a paper nobody has filed. People are settled
     * against that at once. The one thing the FILE can no longer truthfully
     * say then is Apply for COR, and until its package is confirmed it is
     * walked back to collecting here rather than left claiming every
     * document is ready over people who read otherwise. Nothing else is
     * re-planned on a read: a status somebody chose is theirs.
     */
    public static function afterChecklistChange(CipApplication $application): void
    {
        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return;
        }

        if ($application->status === Status::APPLY_FOR_COR
            && ! $application->isCorLocked()
            && ! Review::packageReady($application)) {
            Review::settle($application);

            return;
        }

        PersonStatus::settle($application);
    }

    /**
     * @param  callable(CipApplication, int): void|null  $report  told each file and how many of its people moved
     * @return array{files:int, people:int, moved:int, failed:int}
     */
    public static function everyPostApprovalFile(?callable $report = null): array
    {
        $done = ['files' => 0, 'people' => 0, 'moved' => 0, 'failed' => 0];

        CipApplication::query()
            ->where('phase', Phase::POST_APPROVAL)
            ->orderBy('id')
            ->chunkById(50, function ($applications) use (&$done, $report) {
                foreach ($applications as $application) {
                    try {
                        [$people, $moved] = self::one($application);
                    } catch (\Throwable $e) {
                        // One file the rules cannot read must not stop the
                        // rest. It is settled again the next time it is opened.
                        $done['failed']++;
                        Log::warning('Could not settle a post-approval application', [
                            'application' => $application->id,
                            'error' => $e->getMessage(),
                        ]);

                        continue;
                    }

                    $done['files']++;
                    $done['people'] += $people;
                    $done['moved'] += $moved ? 1 : 0;

                    if ($report !== null) {
                        $report($application, $people, $moved);
                    }
                }
            });

        return $done;
    }

    /**
     * Settle one file.
     *
     * @return array{0:int, 1:bool}  people whose status changed, and whether the file itself moved
     */
    public static function one(CipApplication $application): array
    {
        $before = self::statuses($application);
        $from = $application->status;

        $after = $application;

        $settle = function () use ($application, &$after) {
            // The checklist first: a person's step is read through it.
            Requirements::materialiseApplication($application);

            /*
             * A file at Approved is the one the old planner was deaf to, so
             * it alone is walked here: a paper already sent back makes it
             * Updates Required, every paper already accepted makes it Apply
             * for COR, and the firm and the provider are told, as they would
             * have been on the day. Every other status already followed its
             * documents and is left exactly where it stands; re-planning
             * those would second-guess a status somebody set on purpose.
             *
             * Not wrapped in a transaction of its own: the engine commits
             * the move and only then announces it, and a notice must never
             * be queued for a status that could still roll back.
             */
            $application = self::relabel($application);
            $after = $application;

            if ($application->status === Status::POST_APPROVED) {
                $after = Review::settle($application);

                return;
            }

            DB::transaction(fn () => PersonStatus::settle($application));
        };

        /*
         * A closed file is finished. Its people are put on the lane's own
         * word for that without stamping the application as changed today,
         * which would float every old file to the top of "newest movement".
         */
        if ($application->status === Status::CLOSED) {
            // Asked of the model being touched, not the one doing the
            // touching: that is where Eloquent looks.
            CipApplication::withoutTouching($settle);
        } else {
            $settle();
        }

        return [
            count(array_diff_assoc(self::statuses($application), $before)),
            $after->status !== $from,
        ];
    }

    /**
     * A decided file the old planner left looking undecided.
     *
     * It knew one collecting label, Post-Approval, so an approved file that
     * had a paper sent back and replaced, or one reopened at Apply for COR,
     * came back wearing Post-Approval with the lane's approval still on the
     * row. That file IS approved, and is put back on the label that says
     * so, quietly: nothing was decided today.
     *
     * Unless a person put it there. Pulling a file from Approved back to
     * Post-Approval by hand was the decision being undone, and the row
     * simply kept it; there the decision is what goes, not the label.
     */
    private static function relabel(CipApplication $application): CipApplication
    {
        if ($application->status !== Status::POST_APPROVAL || $application->decision !== Status::POST_APPROVED) {
            return $application;
        }

        $last = CipEvent::query()
            ->where('application_id', $application->getKey())
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::POST_APPROVAL)
            ->orderByDesc('id')
            ->first();

        /*
         * From Approved, and by a person. Post-Approval was also the mapped
         * step back from Updates Required, and the label an officer pulled
         * Apply for COR back to in order to keep collecting; neither of
         * those was anybody undoing an approval.
         */
        $byHand = $last !== null
            && $last->actor_id !== null
            && $last->from_status === Status::POST_APPROVED
            && ($last->meta['reason'] ?? null) !== 'checklist';

        if ($byHand) {
            // What the engine does itself now when a file is put back
            // there: the grant the file held before the lane decided it.
            [$earlier, $earlierAt] = Engine::decisionBeforeLane($application);
            $application->forceFill(['decision' => $earlier, 'decided_at' => $earlierAt])->save();

            return $application;
        }

        return Engine::set($application, Status::POST_APPROVED, null, ['reason' => 'checklist']);
    }

    /** @return array<int, ?string>  by person id */
    private static function statuses(CipApplication $application): array
    {
        return CipPerson::query()
            ->where('application_id', $application->id)
            ->pluck('post_approval_status', 'id')
            ->all();
    }
}
