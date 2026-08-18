<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * §15 — Ready to submit, confirm, lock.
 *
 * When every required document is Ready for submission the application
 * auto-flips here (see {@see Review::settle()}). The submitting party — the
 * service provider contact, or the private client on a PRI file — is told,
 * and must press Confirm submission. That press freezes the original package:
 * person folders become view-only (§17), outstanding upload links into them
 * are withdrawn, and Additional Documents stays writable. The status stays
 * Ready to submit until staff record the CIP number (§16).
 */
class Confirmation
{
    /**
     * What a screen needs to offer (or hide) the confirm verb.
     *
     * @return array{locked:bool, lockedAt:?string, canConfirm:bool}
     */
    public static function payload(CipApplication $application, ?User $actor): array
    {
        return [
            'locked' => $application->isLocked(),
            'lockedAt' => $application->locked_at?->toIso8601String(),
            'canConfirm' => $actor !== null && self::allows($actor, $application),
        ];
    }

    /**
     * May this actor press Confirm submission right now?
     *
     * Staff record the CIP number; they do not confirm. The button is the
     * provider side's, and only while the file stands at Ready to submit and
     * the package is still open.
     */
    public static function allows(User $actor, CipApplication $application): bool
    {
        return $application->status === Status::READY_TO_SUBMIT
            && ! $application->isLocked()
            && self::isSubmittingParty($actor, $application);
    }

    /**
     * Freeze the original package.
     *
     * Idempotent when already locked: a double-click is the state it already
     * is, not a second confirmation. A stranger still cannot learn the file
     * exists by being refused a lock that is already on.
     *
     * @throws AuthorizationException
     * @throws \InvalidArgumentException
     */
    public static function confirm(CipApplication $application, User $actor): CipApplication
    {
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

        return DB::transaction(function () use ($application, $actor) {
            $application->forceFill(['locked_at' => now()])->save();

            Package::forget();
            Package::revokeOutstandingLinks($application);

            Engine::record($application, CipEvent::ACTION_PACKAGE_CONFIRMED, $actor, [
                'reason' => 'confirm_submission',
            ]);

            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.package_confirmed',
                'module' => 'cip',
                'description' => $application->displayNumber().' package confirmed',
                'subject' => $application,
            ]);

            return $application->refresh();
        });
    }

    /**
     * Tell the provider side the file is ready and they must confirm.
     *
     * Fired when the application reaches Ready to submit, once — the same
     * once-per-episode rule §14 uses for updates. The postcard IS this
     * notification's email; bells go to member accounts with the email
     * channel off.
     */
    public static function announce(CipApplication $application, ?User $actor): void
    {
        $facts = Contacts::facts($application);
        $path = Contacts::path($application);
        $url = Contacts::url($application);

        foreach (Contacts::providerSide($application) as $recipient) {
            Deliveries::send(
                Postcards::cipReadyToSubmit($facts, $url, $recipient['name']),
                $recipient['email'],
                $application,
                'cip-ready-to-submit',
                immediate: true,
            );

            if ($recipient['userId'] !== null) {
                Notifier::send([
                    'user' => User::find($recipient['userId']),
                    'actor' => $actor,
                    'type' => 'cip.ready-to-submit',
                    'title' => $facts['number'].' is ready to submit',
                    'message' => 'Confirm submission to lock the original package.',
                    'subject' => $application,
                    'action_url' => $path,
                    'email' => false,
                ]);
            }
        }
    }

    /**
     * Refuse a write into a frozen package.
     *
     * @throws \InvalidArgumentException
     */
    public static function guard(?CipApplication $application): void
    {
        if ($application?->isLocked()) {
            throw new \InvalidArgumentException(
                'This application’s original submission package is locked and cannot be modified.',
            );
        }
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
