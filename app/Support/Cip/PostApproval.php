<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;

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

        foreach ($application->people as $person) {
            if ($person->post_approval_status === null) {
                $person->forceFill([
                    'post_approval_status' => PersonStatus::NOT_STARTED,
                ])->save();
            }
        }

        return $application->refresh();
    }

    /**
     * A post-approval filing the Unit had already denied.
     *
     * The file enters the lane the way every post-approval filing does, so
     * its folders and checklist exist, then lands on Denied with the
     * decision and the day recorded, in one write. Not through the engine:
     * the provider side files these too and holds no cip.decide, and the
     * engine's own announce would send a Post-Approval notice the denial
     * then contradicts. The caller announces Denied once, after the commit.
     */
    public static function denyAtIntake(CipApplication $application, User $actor): CipApplication
    {
        $from = $application->status;
        $decidedAt = now();

        $application->forceFill([
            'status' => Status::POST_DENIED,
            'decision' => Status::POST_DENIED,
            'decided_at' => $decidedAt,
        ])->save();

        $meta = [
            'decision' => Status::POST_DENIED,
            'decidedAt' => $decidedAt->toDateString(),
            'atIntake' => true,
        ];
        Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, $meta, $from, Status::POST_DENIED);
        Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $actor, $meta);

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
