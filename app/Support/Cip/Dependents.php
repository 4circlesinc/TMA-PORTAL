<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;

/**
 * Qualified-dependent numbering (§5).
 *
 * The ordinal is computed, never typed. It is a position in a sorted list, so
 * letting anyone enter it would mean two dependents could both be QD2, or a
 * removal could leave a gap the government's form has no way to read.
 * Everything that adds, edits or removes a dependent calls renumber()
 * afterwards and the list is correct again by construction.
 *
 * Youngest first: §5's worked example numbers the youngest qualified
 * dependent QD1. ⚠ The meeting transcript contradicts this once, "the oldest
 * person is always one", and that is open client question 13. It is one
 * comparison; {@see self::YOUNGEST_FIRST} is the switch, and flipping it
 * renumbers every application the next time each is touched.
 *
 * Spouses sit outside the numbering entirely. A spouse is a dependent by
 * relationship but not a *qualified* dependent, and numbering them would
 * shift every ordinal on the form.
 */
class Dependents
{
    public const YOUNGEST_FIRST = true;

    /**
     * Recompute every qualified dependent's ordinal on this application.
     *
     * @return int how many were numbered
     */
    public static function renumber(CipApplication $application): int
    {
        $qualified = $application->people()
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->where('relationship', CipPerson::RELATIONSHIP_QUALIFIED)
            ->get()
            // Date of birth ascending is oldest first, so youngest-first is
            // the reverse. A missing date sorts last either way rather than
            // stealing QD1 from someone who gave one.
            ->sortBy(fn (CipPerson $p) => $p->date_of_birth?->timestamp ?? PHP_INT_MAX)
            ->values();

        if (self::YOUNGEST_FIRST) {
            $qualified = $qualified->reverse()->values();
        }

        $qualified->each(function (CipPerson $person, int $index) {
            $ordinal = $index + 1;
            if ($person->dependent_ordinal !== $ordinal) {
                $person->forceFill(['dependent_ordinal' => $ordinal])->save();
            }
        });

        // A spouse that was previously numbered (relationship changed) stops
        // being numbered rather than keeping a stale ordinal.
        $application->people()
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->where('relationship', '!=', CipPerson::RELATIONSHIP_QUALIFIED)
            ->whereNotNull('dependent_ordinal')
            ->update(['dependent_ordinal' => null]);

        return $qualified->count();
    }

    /**
     * What this person is called on the application, "Spouse", "Qualified
     * Dependent 2". One phrasing, so the folder tree, the checklist and the
     * submitted form cannot disagree.
     */
    public static function label(CipPerson $person): string
    {
        if ($person->role !== CipPerson::ROLE_DEPENDENT) {
            return $person->role === CipPerson::ROLE_SPONSOR ? 'Sponsor' : 'Main Applicant';
        }

        if ($person->relationship === CipPerson::RELATIONSHIP_SPOUSE) {
            return 'Spouse';
        }

        return 'Qualified Dependent'.($person->dependent_ordinal ? ' '.$person->dependent_ordinal : '');
    }
}
