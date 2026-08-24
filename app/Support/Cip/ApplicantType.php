<?php

namespace App\Support\Cip;

use App\Models\CipPerson;

/**
 * Which checklist a person on an application owes (§12).
 *
 * `cip_document_requirements` is keyed on these five values, so a person's
 * type decides every document they are asked for. That makes this the one
 * place the question is answered: a second rule somewhere else would not be a
 * second opinion, it would be a family shown two different checklists.
 *
 * The type is derived on every read, never stored. Role and date of birth are
 * already on the person, and a stored copy of a computable answer is a copy
 * that goes stale, a dependant's date of birth is corrected far more often
 * than anyone would remember to re-classify them afterwards.
 *
 * A spouse is a dependant by relationship but never by age: they are filed as
 * a spouse whatever year they were born, so the age brackets only ever apply
 * to the children. {@see Dependents::label()} already decides that, and this
 * class asks it rather than deciding again.
 */
class ApplicantType
{
    public const PRINCIPAL_APPLICANT = 'principal_applicant';

    public const SPOUSE = 'spouse';

    public const DEPENDENT_UNDER_16 = 'dependent_under_16';

    public const DEPENDENT_16_OVER = 'dependent_16_over';

    public const SPONSOR = 'sponsor';

    /**
     * The order a family is read in, the applicant, then the household
     * youngest bracket first, then the sponsor, who is on the application
     * rather than of it. Checklists, pickers and the requirements screen all
     * list them this way, so a reader's eye lands in the same place on each.
     *
     * @var list<string>
     */
    public const ALL = [
        self::PRINCIPAL_APPLICANT,
        self::SPOUSE,
        self::DEPENDENT_UNDER_16,
        self::DEPENDENT_16_OVER,
        self::SPONSOR,
    ];

    /**
     * The five types with the words to print. {@see self::ALL} is the same
     * order without them.
     *
     * The two brackets take their number from the configured cutoff rather
     * than from their own names: the keys are frozen, because requirement rows
     * are stored against them, but a firm that sets the boundary at 18 must
     * not be shown a heading that says 16.
     *
     * @return array<string, string>
     */
    public static function all(): array
    {
        return [
            self::PRINCIPAL_APPLICANT => 'Principal applicant',
            self::SPOUSE => 'Spouse',
            self::DEPENDENT_UNDER_16 => 'Dependent under '.self::cutoff(),
            self::DEPENDENT_16_OVER => 'Dependent '.self::cutoff().' and over',
            self::SPONSOR => 'Sponsor',
        ];
    }

    public static function label(string $type): string
    {
        return self::all()[$type] ?? $type;
    }

    public static function isValid(string $type): bool
    {
        return in_array($type, self::ALL, true);
    }

    /** Which of the five this person is. */
    public static function for(CipPerson $person): string
    {
        if ($person->role === CipPerson::ROLE_SPONSOR) {
            return self::SPONSOR;
        }

        // There is no fourth role: anyone who is neither sponsor nor dependant
        // is the person the application is filed for.
        if ($person->role !== CipPerson::ROLE_DEPENDENT) {
            return self::PRINCIPAL_APPLICANT;
        }

        return self::isSpouse($person) ? self::SPOUSE : self::bracket($person);
    }

    /**
     * The age at which a dependant crosses into the older bracket, the firm's
     * to set, and explained in config/cip.php.
     */
    public static function cutoff(): int
    {
        return (int) config('cip.dependent_age_cutoff', 16);
    }

    /**
     * Dependents::label() is the authority, because it is what the folder tree
     * and the filed form already call this person. The pattern behind it
     * catches relationships that did not come through the intake form, where
     * the value is whatever the source system wrote, "Spouse", "spouse of
     * applicant", and where reading it as a child would be the worst
     * available answer.
     */
    private static function isSpouse(CipPerson $person): bool
    {
        return Dependents::label($person) === 'Spouse'
            || preg_match('/spouse/i', (string) $person->relationship) === 1;
    }

    /**
     * The age bracket, measured on the day the application was created rather
     * than today, see config/cip.php for why the reference date matters.
     * now() stands in for a person whose application has not been saved yet,
     * where the two dates are the same day anyway.
     *
     * A dependant with no date of birth reads as the older bracket, which is
     * the one that asks more of them. Over-asking is a question a reviewer can
     * waive; under-asking files an application short, and nobody finds that
     * out until the government does.
     */
    private static function bracket(CipPerson $person): string
    {
        $birth = $person->date_of_birth;

        if ($birth === null) {
            return self::DEPENDENT_16_OVER;
        }

        $reference = $person->application?->created_at ?? now();

        // They cross on the morning of the birthday, so a birthday that is
        // still ahead of the reference date leaves them in the younger set.
        return $birth->copy()->addYears(self::cutoff())->isAfter($reference)
            ? self::DEPENDENT_UNDER_16
            : self::DEPENDENT_16_OVER;
    }
}
