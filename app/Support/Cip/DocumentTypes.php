<?php

namespace App\Support\Cip;

use App\Models\CipPerson;

/**
 * The document requirements that exist before Phase 3's template engine does.
 *
 * Section 2 names three uploads at intake, the passport photo, the passport bio
 * page and the birth certificate. They are constants here rather than rows
 * because they have to mean the same thing on both sides of the templates
 * table: when Phase 3 seeds `cip_document_requirements`, these slugs are what
 * it seeds, and the slots filled today keep answering the same question.
 *
 * The photo is in the list even though {@see PassportPhoto} stores it on the
 * person. The slot records that the requirement was met; the person holds the
 * likeness, because that is what a profile picture is drawn from. One upload
 * still, answered in both places.
 */
class DocumentTypes
{
    public const PASSPORT_PHOTO = 'passport_photo';

    public const PASSPORT_BIO_PAGE = 'passport_bio_page';

    public const BIRTH_CERTIFICATE = 'birth_certificate';

    public const OATH_OF_ALLEGIANCE = 'oath_of_allegiance';

    public const PROOF_OF_PAYMENT = 'proof_of_payment';

    public const LETTER_OF_CONFIRMATION = 'letter_of_confirmation';

    public const SALES_PURCHASE_AGREEMENT = 'sales_purchase_agreement';

    public const ESCROW_AGREEMENT = 'escrow_agreement';

    /** @var array<string, string> */
    public const LABELS = [
        self::PASSPORT_PHOTO => 'Passport Photo',
        self::PASSPORT_BIO_PAGE => 'Passport Bio Page',
        self::BIRTH_CERTIFICATE => 'Birth Certificate',
        self::OATH_OF_ALLEGIANCE => 'Oath of Allegiance',
        self::PROOF_OF_PAYMENT => 'Proof of Payment of the Qualifying Investment',
        self::LETTER_OF_CONFIRMATION => 'Letter of Confirmation',
        self::SALES_PURCHASE_AGREEMENT => 'Sales and Purchase Agreement',
        self::ESCROW_AGREEMENT => 'Escrow Agreement',
        'sl1_form' => 'SL1 Form',
        'sl2a_form' => 'SL2A Form',
        'sl2b_form' => 'SL2B Form',
        'sl3_form' => 'SL3 Form',
        'sl4_form' => 'SL4 Form',
    ];

    /**
     * What a person of this role owes at intake.
     *
     * Everyone on an application owes the same three eventually; only the
     * main applicant is asked for them while the application is being
     * created. A sponsor's and a dependent's slots are opened empty, so their
     * repository exists from the first save and Phase 3 has somewhere to
     * put the rest of the checklist.
     *
     * @return array<int, string>
     */
    public static function forRole(string $role): array
    {
        return match ($role) {
            CipPerson::ROLE_MAIN_APPLICANT, CipPerson::ROLE_SPONSOR => [
                self::PASSPORT_PHOTO,
                self::PASSPORT_BIO_PAGE,
                self::BIRTH_CERTIFICATE,
            ],
            // A dependent's checklist depends on their age bracket, which is
            // Phase 3's rule. Until then they carry the two documents no
            // dependent is without.
            default => [
                self::PASSPORT_BIO_PAGE,
                self::BIRTH_CERTIFICATE,
            ],
        };
    }

    public static function label(string $type): string
    {
        if (isset(self::LABELS[$type])) {
            return self::LABELS[$type];
        }

        // A form key that is not in the map still has to read SL, with a
        // capital L. ucfirst("sl1_form") is "Sl1 form", and this face draws
        // a lowercase L as a bare stem, the same shape as a capital I.
        if (preg_match('/^sl(\d+)([a-z])?_form$/', $type, $match) === 1) {
            $suffix = ($match[2] ?? '') !== '' ? strtoupper($match[2]) : '';

            return 'SL'.$match[1].$suffix.' Form';
        }

        return self::present(ucfirst(str_replace('_', ' ', $type)));
    }

    /**
     * The document name a reader should see.
     *
     * Form codes are written SL, with a capital L and a capital suffix, so
     * "Sl1", "sl1" and a misread "SI1" all display as SL1. Every other word
     * that is still lowercase takes a capital, except the small words a
     * title keeps down. A name that is already in that shape is left as it
     * is, including ePP and JPEG.
     */
    public static function present(string $label): string
    {
        $label = self::presentFormCodes($label);

        $small = ['a', 'an', 'and', 'or', 'of', 'the', 'for', 'to', 'from', 'in', 'on', 'over', 'with', 'age'];
        $parts = preg_split('/(\s+)/u', $label, -1, PREG_SPLIT_DELIM_CAPTURE);
        if ($parts === false) {
            return $label;
        }

        $words = [];
        foreach ($parts as $index => $part) {
            if (preg_match('/\S/u', $part) === 1) {
                $words[] = $index;
            }
        }

        if ($words === []) {
            return $label;
        }

        $first = $words[0];
        $last = $words[array_key_last($words)];
        foreach ($words as $index) {
            $parts[$index] = self::capitalizeToken($parts[$index], $small, $index === $first || $index === $last);
        }

        return implode('', $parts);
    }

    /**
     * SL form codes only, safe to run over a whole sentence.
     *
     * The capital L is the whole of the "SL" versus "SI" reading: a
     * lowercase L in Inter is a stem, and so is a capital I.
     */
    public static function presentFormCodes(string $text): string
    {
        $presented = preg_replace_callback(
            '/\b[Ss][IlLi](\d+)([A-Za-z])?(?:\s+[Ff]orm)?\b/u',
            static function (array $match): string {
                $suffix = ($match[2] ?? '') !== '' ? strtoupper($match[2]) : '';
                $form = preg_match('/form$/i', $match[0]) === 1 ? ' Form' : '';

                return 'SL'.$match[1].$suffix.$form;
            },
            $text,
        );

        return is_string($presented) ? $presented : $text;
    }

    /**
     * @param  list<string>  $small
     */
    private static function capitalizeToken(string $token, array $small, bool $edge): string
    {
        if (preg_match('/^(\p{P}*)(.*?)(\p{P}*)$/u', $token, $match) !== 1) {
            return $token;
        }

        [, $lead, $core, $tail] = $match;
        if ($core === '' || preg_match('/\d/u', $core) === 1 || preg_match('/\p{Lu}/u', $core) === 1) {
            return $token;
        }

        $segments = explode('-', $core);
        foreach ($segments as $index => $segment) {
            $lower = mb_strtolower(trim($segment, "'’"));
            if ($lower === '' || (in_array($lower, $small, true) && ! ($edge && $index === 0))) {
                continue;
            }

            if (preg_match('/^\p{Ll}/u', $segment) === 1) {
                $segments[$index] = mb_strtoupper(mb_substr($segment, 0, 1)).mb_substr($segment, 1);
            }
        }

        return $lead.implode('-', $segments).$tail;
    }
}
