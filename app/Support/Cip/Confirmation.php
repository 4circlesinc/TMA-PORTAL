<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Ready to submit / Apply for COR, confirm, lock.
 *
 * When every required document is Ready for submission the application
 * auto-flips here (see {@see Review::settle()}). The submitting party, the
 * service provider contact, or the private client on a PRI file, is told,
 * and must press Confirm submission. That press freezes the package for the
 * current lane: person folders on Ready to submit (§17), the Certificate of
 * Registration tree on Apply for COR. Additional Documents stays writable.
 * Status stays on the ready label until staff take the next recorded step.
 */
class Confirmation
{
    public const LOCKED_MESSAGE = 'This application’s original submission package is locked and cannot be modified.';

    public const COR_LOCKED_MESSAGE = 'This application’s Certificate of Registration package is locked and cannot be modified.';

    public const CLOSED_MESSAGE = 'This application’s file is closed and cannot be modified.';

    /**
     * What a screen needs to offer (or hide) the confirm verb.
     *
     * @return array{locked:bool, lockedAt:?string, corLocked:bool, corLockedAt:?string, canConfirm:bool}
     */
    public static function payload(CipApplication $application, ?User $actor): array
    {
        return [
            'locked' => $application->isLocked(),
            'lockedAt' => $application->locked_at?->toIso8601String(),
            'corLocked' => $application->isCorLocked(),
            'corLockedAt' => $application->cor_locked_at?->toIso8601String(),
            'canConfirm' => $actor !== null && self::allows($actor, $application),
        ];
    }

    /**
     * May this actor press Confirm submission right now?
     *
     * Staff record the CIP number / COR submission date; they do not confirm.
     * The button is the provider side's, while the file stands at Ready to
     * submit or Apply for COR and that lane's package is still open.
     */
    public static function allows(User $actor, CipApplication $application): bool
    {
        if (! self::isSubmittingParty($actor, $application)) {
            return false;
        }

        if ($application->status === Status::READY_TO_SUBMIT && ! $application->isLocked()) {
            return true;
        }

        return $application->status === Status::APPLY_FOR_COR && ! $application->isCorLocked();
    }

    /**
     * Freeze the current lane's package, on the day it was confirmed.
     *
     * The day is asked for rather than assumed, the way §16's submission and
     * §21's decision are: "when did this stop being changeable" is the first
     * question asked of a package the Unit later queries, and a firm entering
     * a file it confirmed last week would have had today stamped on it with
     * nothing to say otherwise. Defaults to today when the caller does not
     * name one, which is the common case and the honest one.
     *
     * Idempotent when already locked: a double-click is the state it already
     * is, not a second confirmation. A stranger still cannot learn the file
     * exists by being refused a lock that is already on. A second press does
     * not move the day either — correcting it is
     * {@see Milestones::correct()}, so a confirmation cannot be quietly
     * re-dated by pressing the button again.
     *
     * @throws AuthorizationException
     * @throws \InvalidArgumentException
     */
    public static function confirm(
        CipApplication $application,
        User $actor,
        ?Carbon $lockedAt = null,
    ): CipApplication {
        if ($application->status === Status::APPLY_FOR_COR) {
            return self::confirmCor($application, $actor, $lockedAt);
        }

        if ($application->isLocked()) {
            if (! self::isSubmittingParty($actor, $application)) {
                throw new AuthorizationException('Only the service provider can confirm this submission.');
            }

            return $application;
        }

        if ($application->status !== Status::READY_TO_SUBMIT) {
            throw new \InvalidArgumentException(
                'Only an application that is ready to submit can be confirmed.',
            );
        }

        if (! self::allows($actor, $application)) {
            throw new AuthorizationException('Only the service provider can confirm this submission.');
        }

        if (! Review::progress($application)['complete']) {
            throw new \InvalidArgumentException(
                'Every required document must be ready for submission before the package can be confirmed.',
            );
        }

        $lockedAt = ($lockedAt ?? Carbon::now())->startOfDay();

        return DB::transaction(function () use ($application, $actor, $lockedAt) {
            $application->forceFill(['locked_at' => $lockedAt])->save();

            Package::forget();
            Package::revokeOutstandingLinks($application);
            Tree::provisionAdditionalDrawers($application, $actor);

            Engine::record($application, CipEvent::ACTION_PACKAGE_CONFIRMED, $actor, [
                'reason' => 'confirm_submission',
                'lockedAt' => $lockedAt->toDateString(),
            ]);

            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.package_confirmed',
                'module' => 'cip',
                'description' => $application->displayNumber().' package confirmed on '.$lockedAt->toDateString(),
                'subject' => $application,
            ]);

            return $application->refresh();
        });
    }

    /**
     * Freeze the Certificate of Registration package. The original
     * pre-approval lock is a different column and is left alone.
     */
    private static function confirmCor(
        CipApplication $application,
        User $actor,
        ?Carbon $lockedAt,
    ): CipApplication {
        if ($application->isCorLocked()) {
            if (! self::isSubmittingParty($actor, $application)) {
                throw new AuthorizationException('Only the service provider can confirm this submission.');
            }

            return $application;
        }

        if (! self::allows($actor, $application)) {
            throw new AuthorizationException('Only the service provider can confirm this submission.');
        }

        if (! Review::progress($application)['complete']) {
            throw new \InvalidArgumentException(
                'Every required document must be ready for submission before the package can be confirmed.',
            );
        }

        $lockedAt = ($lockedAt ?? Carbon::now())->startOfDay();

        return DB::transaction(function () use ($application, $actor, $lockedAt) {
            $application->forceFill(['cor_locked_at' => $lockedAt])->save();

            Package::forget();
            Package::revokeCorLinks($application);

            Engine::record($application, CipEvent::ACTION_COR_PACKAGE_CONFIRMED, $actor, [
                'reason' => 'confirm_submission',
                'lockedAt' => $lockedAt->toDateString(),
            ]);

            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.cor_package_confirmed',
                'module' => 'cip',
                'description' => $application->displayNumber().' COR package confirmed on '.$lockedAt->toDateString(),
                'subject' => $application,
            ]);

            return $application->refresh();
        });
    }

    /**
     * Refuse a write into a frozen original package.
     *
     * Confirm submission stamps `locked_at`. That freeze is the scans the
     * Unit is about to be handed, not every later write on the application:
     * file status is a review label, and post-approval paper lives in its
     * own drawer. Call {@see guardDocument()} when the write is about one
     * slot, and this when it is about the application itself (intake, a new
     * original-package upload).
     *
     * @throws \InvalidArgumentException
     */
    public static function guard(?CipApplication $application): void
    {
        if ($application?->isLocked()) {
            throw new \InvalidArgumentException(self::LOCKED_MESSAGE);
        }
    }

    /**
     * Refuse a write that would change a frozen original-package or COR slot.
     *
     * @throws \InvalidArgumentException
     */
    public static function guardDocument(CipDocument $document): void
    {
        if (! Package::locksDocument($document)) {
            return;
        }

        $document->loadMissing(['requirement', 'application']);

        if ($document->application?->isClosed()) {
            throw new \InvalidArgumentException(self::CLOSED_MESSAGE);
        }

        $requirement = $document->requirement;
        $corSlot = $requirement
            && $requirement->at_post_approval
            && ! $requirement->at_pre_approval;

        throw new \InvalidArgumentException(
            $corSlot ? self::COR_LOCKED_MESSAGE : self::LOCKED_MESSAGE
        );
    }

    /** Is this library file part of a confirmed original package? */
    public static function locksFile(FileItem $file): bool
    {
        return Package::locksFile($file);
    }

    /**
     * The submitting party for this file: an active member of the provider
     * firm, or the private client the application is filed for. Staff record
     * the CIP number; they are never this.
     */
    public static function isSubmittingParty(User $actor, CipApplication $application): bool
    {
        if (Role::isStaff($actor)) {
            return false;
        }

        if (! CipAccess::isProviderContact($actor) && ! CipAccess::isPrivateClient($actor)) {
            return false;
        }

        return ApplicationScope::query($actor)->whereKey($application->getKey())->exists();
    }
}
