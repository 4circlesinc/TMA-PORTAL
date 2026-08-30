<?php

namespace App\Support\Cip;

use App\Models\CipPerson;

/**
 * The document requirements that exist before Phase 3's template engine does.
 *
 * §2 names three uploads at intake, the passport photo, the passport bio
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
        self::PASSPORT_PHOTO => 'Passport photo',
        self::PASSPORT_BIO_PAGE => 'Passport bio page',
        self::BIRTH_CERTIFICATE => 'Birth certificate',
        self::OATH_OF_ALLEGIANCE => 'Oath of Allegiance',
        self::PROOF_OF_PAYMENT => 'Proof of Payment of the Qualifying Investment',
        self::LETTER_OF_CONFIRMATION => 'Letter of Confirmation',
        self::SALES_PURCHASE_AGREEMENT => 'Sales and Purchase Agreement',
        self::ESCROW_AGREEMENT => 'Escrow Agreement',
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
        return self::LABELS[$type] ?? ucfirst(str_replace('_', ' ', $type));
    }
}
