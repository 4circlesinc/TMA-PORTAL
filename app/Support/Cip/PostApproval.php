<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\User;
use Illuminate\Support\Facades\DB;

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
     * Move a granted pre-approval application into post-approval.
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

        return DB::transaction(function () use ($application, $actor) {
            $application->forceFill([
                'phase' => Phase::POST_APPROVAL,
                'post_approval_at' => now(),
            ])->save();

            Engine::record($application, 'post_approval_entered', $actor, []);

            return self::prepare($application->fresh(), $actor);
        });
    }
}
