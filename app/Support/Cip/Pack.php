<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocumentRequirement;

/**
 * Which post-approval document pack a file is collecting, and which packs
 * have already been opened.
 *
 * COR slots appear when the file enters post-approval. NIC slots wait until
 * the COR received date has been recorded (brief §7). Passport slots wait
 * until the NIC received date (brief §9). A later pack must not be judged
 * as part of the earlier one: leftover NIC blanks would otherwise block
 * Apply for COR, leftover passport blanks would block Apply for NIC, and a
 * confirmed COR tree must not freeze NIC or passport uploads.
 */
class Pack
{
    public const COR = 'COR';

    public const NIC = 'NIC';

    public const PASSPORT = 'Passport';

    /**
     * Packs whose slots should be on the checklist right now.
     *
     * @return list<string>
     */
    public static function open(?CipApplication $application): array
    {
        if ($application === null || ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return [];
        }

        $open = [self::COR];

        if (self::hasReachedNic($application)) {
            $open[] = self::NIC;
        }

        if (self::hasReachedPassport($application)) {
            $open[] = self::PASSPORT;
        }

        return $open;
    }

    /**
     * Packs that will open later, so materialise does not withdraw their
     * carried-forward slots while the file is still on an earlier stage.
     *
     * @return list<string>
     */
    public static function upcoming(?CipApplication $application): array
    {
        if ($application === null || ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return [];
        }

        $upcoming = [];

        if (! self::hasReachedNic($application)) {
            $upcoming[] = self::NIC;
        }

        if (! self::hasReachedPassport($application)) {
            $upcoming[] = self::PASSPORT;
        }

        return $upcoming;
    }

    /** The pack Review is judging for Updates Required / Apply for … */
    public static function current(?CipApplication $application): ?string
    {
        if ($application === null || ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return null;
        }

        if (self::hasReachedPassport($application)) {
            return self::PASSPORT;
        }

        return self::hasReachedNic($application) ? self::NIC : self::COR;
    }

    public static function of(CipDocumentRequirement $row): ?string
    {
        $folder = trim((string) $row->folder);

        if (PassportRequirements::owns($row->key)
            && ! NicRequirements::owns($row->key)
            && ! CorRequirements::owns($row->key)) {
            return self::PASSPORT;
        }

        if (NicRequirements::owns($row->key) && ! CorRequirements::owns($row->key)) {
            return self::NIC;
        }

        if (CorRequirements::owns($row->key)) {
            return self::COR;
        }

        // Folder names only classify custom post-approval rows. A pre-approval
        // template an administrator filed under "Passport" is a named drawer,
        // not Stage 3.
        if ($row->at_post_approval) {
            if ($folder === PassportRequirements::FOLDER) {
                return self::PASSPORT;
            }

            if ($folder === NicRequirements::FOLDER) {
                return self::NIC;
            }

            if ($folder === CorRequirements::FOLDER) {
                return self::COR;
            }

            return self::COR;
        }

        if ($row->carry_forward) {
            return self::COR;
        }

        return null;
    }

    /**
     * NIC and Passport drawers stay writable after the COR package is
     * confirmed. COR drawers freeze.
     */
    public static function staysOpenAfterCorLock(?CipDocumentRequirement $row): bool
    {
        $pack = $row ? self::of($row) : null;

        return in_array($pack, [self::NIC, self::PASSPORT], true);
    }

    /**
     * @return list<string>
     */
    public static function keys(string $pack): array
    {
        return match ($pack) {
            self::PASSPORT => PassportRequirements::keys(),
            self::NIC => NicRequirements::keys(),
            default => CorRequirements::keys(),
        };
    }

    public static function folder(string $pack): string
    {
        return match ($pack) {
            self::PASSPORT => PassportRequirements::FOLDER,
            self::NIC => NicRequirements::FOLDER,
            default => CorRequirements::FOLDER,
        };
    }

    public static function hasReachedNic(CipApplication $application): bool
    {
        if ($application->cor_received_at !== null) {
            return true;
        }

        return in_array($application->status, [
            Status::APPLY_FOR_NIC,
            Status::PENDING_NIC,
            Status::APPLY_FOR_PASSPORT,
            Status::PENDING_PASSPORT,
            Status::READY_FOR_DELIVERY,
            Status::CLOSED,
        ], true);
    }

    public static function hasReachedPassport(CipApplication $application): bool
    {
        if ($application->nic_received_at !== null) {
            return true;
        }

        return in_array($application->status, [
            Status::APPLY_FOR_PASSPORT,
            Status::PENDING_PASSPORT,
            Status::READY_FOR_DELIVERY,
            Status::CLOSED,
        ], true);
    }
}
