<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Recording a submission to the Unit (section 16), and with it the switch from the
 * internal number to the CIP number (section 7). An Add-On goes the same way:
 * the Unit issues it a CIP number of its own, and that number, not the
 * parent's, is the one the Add-On is known by from here on (Add-On section 15).
 *
 * Section 7 keeps two numbers for one application. The internal number is ours,
 * generated on creation and permanent, invoices, drafts, reviews and
 * assessment feedback all refer to it, and it stays stored and searchable
 * forever. The CIP number is the government's, and it does not exist until
 * the Unit has the application in hand.
 *
 * This is the moment the second number arrives on a family file. Because every
 * user-facing surface renders {@see CipApplication::displayNumber()} and
 * nothing else, writing it here flips dashboards, reports, status screens,
 * email subjects and search results in one move, which is exactly why the
 * rule was built as one accessor in phase 1d rather than a formatting decision
 * repeated per screen.
 *
 * An Add-On arrives here with its AO reference and leaves with the CIP number
 * the Unit gave the Add-On itself. The parent's CIP and COR stay on the parent
 * and are never copied down: an Add-On showing its parent's number up front
 * was the mistake this lane used to make. Alongside the number this verb
 * records the submission date, who recorded it, and the Add-On type already
 * on the row — then Pending Review, with the locked package left intact for
 * audit.
 *
 * The status change goes through {@see Engine}, not around it: submission is
 * READY_TO_SUBMIT → PENDING REVIEW, it needs `cip.compliance`, and it writes
 * the append-only event. Recording a number is not a way to skip the
 * lifecycle.
 */
class Submission
{
    /**
     * The Unit's own identifier, its shape is theirs, not ours.
     *
     * Long enough for anything they have issued (`10T1G12661P` is eleven) with
     * room to spare, and no pattern: a regex here would be us guessing at a
     * foreign format and refusing a number that is on a real letter.
     */
    public const MAX_LENGTH = 64;

    /**
     * Record it: the number, the date it went, who recorded it, and the move
     * to Pending review.
     *
     * @throws ValidationException the number is blank or already in use, or the package is still open
     * @throws \InvalidArgumentException the application is not ready to submit
     * @throws AuthorizationException
     */
    public static function record(
        CipApplication $application,
        User $actor,
        ?string $cipNumber = null,
        ?Carbon $submittedAt = null,
    ): CipApplication {
        $number = self::clean((string) $cipNumber);
        self::assertFree($number, $application);

        if ($application->isAddOn()) {
            return self::recordAddOn($application, $actor, $number, $submittedAt);
        }

        if (! $application->isLocked()) {
            throw ValidationException::withMessages([
                'cipNumber' => 'The service provider must confirm submission before the package can be sent to the Unit.',
            ]);
        }

        $submittedAt ??= Carbon::now();

        return DB::transaction(function () use ($application, $actor, $number, $submittedAt) {
            /*
             * Written before the transition, so the trail names the
             * application by what it is called from now on. The internal
             * number travels in the event's own meta, which is where somebody
             * reconciling an invoice against this row will look for it.
             */
            $application->forceFill([
                'cip_number' => $number,
                'submitted_at' => $submittedAt,
                'submitted_by' => $actor->name,
            ])->save();

            Engine::apply($application, Status::PENDING_REVIEW, $actor, [
                'cipNumber' => $number,
                'internalNumber' => $application->internal_number,
                'submittedAt' => $submittedAt->toDateString(),
                'submittedBy' => $actor->name,
            ]);

            Engine::record($application, CipEvent::ACTION_NUMBER_ASSIGNED, $actor, [
                'cipNumber' => $number,
                'internalNumber' => $application->internal_number,
            ]);

            return $application->refresh();
        });
    }

    /**
     * Add-On section 15: the Add-On's own CIP number, the day, who recorded
     * it, the Add-On type, Pending Review.
     *
     * The number is the one on the Unit's letter for the Add-On, cleaned and
     * checked for collisions by the caller exactly as a family file's is, so
     * it can never repeat the parent's. The AO reference stays stored for
     * audit and invoicing; the parent's CIP / COR stay on the parent. The
     * package was already frozen by {@see Confirmation::confirm()}.
     *
     * @throws ValidationException the package is still open
     * @throws \InvalidArgumentException the application is not ready to submit
     * @throws AuthorizationException
     */
    private static function recordAddOn(
        CipApplication $application,
        User $actor,
        string $number,
        ?Carbon $submittedAt = null,
    ): CipApplication {
        if (! $application->isLocked()) {
            throw ValidationException::withMessages([
                'cipNumber' => 'The service provider must confirm submission before the package can be sent to the Unit.',
            ]);
        }

        $submittedAt ??= Carbon::now();
        $submittedBy = trim((string) $actor->name) !== '' ? (string) $actor->name : $actor->email;

        return DB::transaction(function () use ($application, $actor, $number, $submittedAt, $submittedBy) {
            $application->forceFill([
                'cip_number' => $number,
                'submitted_at' => $submittedAt,
                'submitted_by' => $submittedBy,
            ])->save();

            Engine::apply($application, Status::PENDING_REVIEW, $actor, [
                'cipNumber' => $number,
                'internalNumber' => $application->internal_number,
                'submittedAt' => $submittedAt->toDateString(),
                'submittedBy' => $submittedBy,
                'addonType' => $application->addon_type,
                'addonTypeLabel' => AddOn::typeLabel($application->addon_type),
            ]);

            Engine::record($application, CipEvent::ACTION_NUMBER_ASSIGNED, $actor, [
                'cipNumber' => $number,
                'internalNumber' => $application->internal_number,
            ]);

            return $application->refresh();
        });
    }

    /**
     * Record the number a post-approval filing arrived with.
     *
     * A file entered straight into post-approval was approved by the Unit
     * before the portal ever saw it, so its CIP number already exists on
     * paper. {@see record} cannot be used for it: that is the pre-approval
     * lifecycle's submission edge, and this application never travelled it.
     * What is shared is the part that matters, the same cleaning and the same
     * one-number-one-application rule, so a number adopted at intake cannot
     * collide with one recorded through submission.
     *
     * No status moves and no capability is checked here: the caller is
     * {@see Intake::create}, which has already established that this account
     * may file under this provider.
     *
     * @throws ValidationException the number is blank or already in use
     */
    public static function adopt(CipApplication $application, User $actor, string $cipNumber): CipApplication
    {
        $number = self::clean($cipNumber);
        self::assertFree($number, $application);

        $application->forceFill(['cip_number' => $number])->save();

        Engine::record($application, CipEvent::ACTION_NUMBER_ASSIGNED, $actor, [
            'cipNumber' => $number,
            'internalNumber' => $application->internal_number,
        ]);

        return $application;
    }

    /**
     * Correct a number already recorded.
     *
     * A digit mistyped from a government letter is not a lifecycle event, and
     * making somebody unwind the status to fix one would be worse than the
     * typo. The status does not move; the correction is still audited, with
     * what it was before.
     */
    public static function correct(CipApplication $application, User $actor, string $cipNumber): CipApplication
    {
        abort_unless(CipAccess::can($actor, 'cip.compliance'), 403, 'You cannot change this application’s CIP number.');

        $number = self::clean($cipNumber);
        self::assertFree($number, $application);

        $was = $application->cip_number;

        return DB::transaction(function () use ($application, $actor, $number, $was) {
            $application->forceFill(['cip_number' => $number])->save();

            Engine::record($application, CipEvent::ACTION_NUMBER_ASSIGNED, $actor, [
                'cipNumber' => $number,
                'previous' => $was,
                'internalNumber' => $application->internal_number,
            ]);

            return $application;
        });
    }

    /**
     * Trimmed, and inner runs of whitespace closed up.
     *
     * Numbers get read off a PDF and pasted, which brings spaces and
     * non-breaking spaces with them. Case is left exactly as given, it is
     * the Unit's identifier and not ours to restyle, but see
     * {@see assertFree}, which compares without it.
     */
    private static function clean(string $number): string
    {
        $number = preg_replace('/\s+/u', '', trim($number)) ?? '';

        if ($number === '') {
            throw ValidationException::withMessages([
                'cipNumber' => 'Enter the CIP application number from the Unit.',
            ]);
        }

        if (mb_strlen($number) > self::MAX_LENGTH) {
            throw ValidationException::withMessages([
                'cipNumber' => 'That CIP number is too long, check it against the letter.',
            ]);
        }

        return $number;
    }

    /**
     * One CIP number, one application.
     *
     * Compared case-insensitively: two rows differing only in case are the
     * same number to everyone but the database, and a search for one would
     * return a stranger's application.
     */
    private static function assertFree(string $number, CipApplication $application): void
    {
        $taken = CipApplication::query()
            ->whereKeyNot($application->getKey())
            ->whereRaw('LOWER(cip_number) = ?', [mb_strtolower($number)])
            ->exists();

        if ($taken) {
            throw ValidationException::withMessages([
                'cipNumber' => 'Another application already has that CIP number.',
            ]);
        }
    }
}
