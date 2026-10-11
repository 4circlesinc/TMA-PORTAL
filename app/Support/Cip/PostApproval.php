<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;

/**
 * Entering the post-approval lane: folder tree, checklist, and carried
 * documents.
 *
 * Called when an application is filed directly into post-approval, or when
 * staff move a granted pre-approval file across manually. Pre-approval
 * history, folders, and filed documents stay; post-approval adds its own
 * repository and materialises the post-approval checklist.
 */
class PostApproval
{
    /**
     * Provision post-approval folders and settle checklists.
     *
     * Safe to call more than once: missing folders are created, slots are
     * materialised idempotently.
     */
    public static function prepare(CipApplication $application, ?User $actor = null): CipApplication
    {
        $application->loadMissing(['people', 'client']);

        Tree::provision($application, $actor);
        Tree::provisionPostApproval($application, $actor);
        Package::forget();
        Requirements::materialiseApplication($application);

        // Everyone on the file takes the step the file is on, read through
        // their own documents. A dependant added later arrives the same way,
        // owing papers an unconfirmed Apply for COR can no longer claim.
        Settlement::afterChecklistChange($application);

        return $application->refresh();
    }

    /**
     * A post-approval filing the Unit had already denied.
     *
     * The file enters the lane the way every post-approval filing does, so
     * its folders and checklist exist, then lands on Denied with the
     * decision, its day, its letter and its note recorded, in one write.
     * Not through the engine: the provider side files these too and holds
     * no cip.decide, and the engine's own announce would send a
     * Post-Approval notice the denial then contradicts. The caller
     * announces Denied once, after the commit.
     */
    public static function denyAtIntake(
        CipApplication $application,
        User $actor,
        ?Carbon $decidedAt = null,
        string $note = '',
        ?UploadedFile $letter = null,
    ): CipApplication {
        return self::decideAtIntake($application, $actor, Status::POST_DENIED, $decidedAt, $note, $letter);
    }

    /**
     * A post-approval filing the Unit had already approved.
     *
     * The twin of {@see denyAtIntake()}: the file enters the lane, then
     * stands on Approved with the decision recorded. Approved is the label
     * a decided file collects its COR documents under, so nothing else
     * changes: the checklist drives it from here exactly as it drives a
     * file approved from the status menu. The caller announces
     * Post-Approval and then Approved, after the commit.
     */
    public static function approveAtIntake(
        CipApplication $application,
        User $actor,
        ?Carbon $decidedAt = null,
        string $note = '',
        ?UploadedFile $letter = null,
    ): CipApplication {
        return self::decideAtIntake($application, $actor, Status::POST_APPROVED, $decidedAt, $note, $letter);
    }

    /**
     * Record at filing what {@see Decision::record()} records from the
     * status menu: the outcome, the day it was made, the Unit's letter and
     * the note that went with it.
     *
     * The letter is filed first, where every decision letter is filed, so
     * the notice the caller sends afterwards carries it. Round the engine,
     * for the reason given above, so the people on the file are settled
     * here: each reads the outcome, or stands further along where their own
     * papers put them.
     */
    private static function decideAtIntake(
        CipApplication $application,
        User $actor,
        string $decision,
        ?Carbon $decidedAt,
        string $note,
        ?UploadedFile $letter,
    ): CipApplication {
        $from = $application->status;
        $decidedAt ??= now();
        $note = trim($note);

        if ($letter !== null) {
            DecisionLetter::store($application, $letter, $actor, $decision);
            $application->refresh();
        }

        $application->forceFill([
            'status' => $decision,
            'decision' => $decision,
            'decided_at' => $decidedAt,
        ])->save();

        $meta = [
            'decision' => $decision,
            'decidedAt' => $decidedAt->toDateString(),
            'atIntake' => true,
        ];
        if ($note !== '') {
            $meta['note'] = $note;
        }

        Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, $meta, $from, $decision);
        Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $actor, $meta);

        PersonStatus::settle($application);

        return $application->refresh();
    }

    /**
     * Move a granted pre-approval application into post-approval.
     *
     * Status, phase, COR checklist, folders and the COR notice all travel
     * through {@see Engine::apply} so the dedicated button and the status
     * picker cannot disagree.
     *
     * @throws \Symfony\Component\HttpKernel\Exception\HttpException
     */
    public static function enter(CipApplication $application, User $actor): CipApplication
    {
        abort_unless(
            $application->phase === Phase::PRE_APPROVAL,
            422,
            'This application is already in post-approval.',
        );

        abort_unless(
            $application->decision === CipApplication::DECISION_GRANTED
                || $application->status === Status::GRANTED,
            422,
            'Only an approved application may enter post-approval.',
        );

        try {
            return Engine::apply($application, Status::POST_APPROVAL, $actor);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }
    }
}
