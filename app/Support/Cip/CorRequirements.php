<?php

namespace App\Support\Cip;

/**
 * Stage 1 (Certificate of Registration) document catalogue.
 *
 * The rows themselves live in {@see \App\Models\CipDocumentRequirement} —
 * Settings is the source of truth once they exist. This class is the shipped
 * default the seeder writes: who owes which COR paper, whether it is
 * required, and the help a reviewer reads. Editing a flag in Settings is
 * what the checklist, the form and the backend all consult afterwards.
 */
class CorRequirements
{
    public const FOLDER = 'COR';

    public const OATH_OF_ALLEGIANCE = 'oath_of_allegiance';

    public const PROOF_OF_PAYMENT = 'proof_of_payment';

    public const LETTER_OF_CONFIRMATION = 'letter_of_confirmation';

    public const SALES_PURCHASE_AGREEMENT = 'sales_purchase_agreement';

    public const ESCROW_AGREEMENT = 'escrow_agreement';

    public const GUIDELINES = 'Documents not written in English MUST be translated. The translation must be original, signed and stamped by a Notary or Attorney-at-Law. A certified true copy of the credentials of the translator, Notary and/or Attorney-at-Law who certified or translated the document must also be provided.';

    /**
     * Keys that belong to Stage 1 COR, including the passport photo that
     * carries forward from pre-approval.
     *
     * @return list<string>
     */
    public static function keys(): array
    {
        return [
            self::OATH_OF_ALLEGIANCE,
            self::PROOF_OF_PAYMENT,
            DocumentTypes::PASSPORT_PHOTO,
            self::LETTER_OF_CONFIRMATION,
            self::SALES_PURCHASE_AGREEMENT,
            self::ESCROW_AGREEMENT,
        ];
    }

    /**
     * Default COR rows, grouped by applicant type.
     *
     * @return array<string, list<array{
     *     key: string,
     *     label: string,
     *     required: bool,
     *     help: string,
     *     folder: ?string,
     *     at_pre_approval: bool,
     *     at_post_approval: bool,
     *     carry_forward: bool,
     *     real_estate_only: bool
     * }>>
     */
    public static function defaults(): array
    {
        $oath = self::row(
            self::OATH_OF_ALLEGIANCE,
            'Oath of Allegiance',
            required: true,
            help: 'Signed by the applicant (16 years and over) and a Notary or Attorney-at-Law. The Notary or Attorney-at-Law, whose name MUST be clearly legible, MUST stamp the document. The date on the Oath cannot be before the granted date. Soft copy only. '.self::GUIDELINES,
        );

        $photo = self::row(
            DocumentTypes::PASSPORT_PHOTO,
            DocumentTypes::label(DocumentTypes::PASSPORT_PHOTO),
            required: true,
            help: 'One digital passport-sized photo, 2 inch × 2 inch. Soft copy only. A pre-approval photo carries forward; replace it if a newer likeness is needed.',
            carryForward: true,
            atPreApproval: true,
            folder: null,
        );

        $payment = self::row(
            self::PROOF_OF_PAYMENT,
            'Proof of Payment of the Qualifying Investment',
            required: true,
            help: 'Proof of payment of the qualifying investment, as set out in the Notification Letter. Forward it to T.M. Antoine Partners Advisory. Soft copy only. '.self::GUIDELINES,
        );

        $confirmation = self::row(
            self::LETTER_OF_CONFIRMATION,
            'Letter of Confirmation',
            required: false,
            help: 'Real Estate applicants only. Soft copy only. '.self::GUIDELINES,
            realEstateOnly: true,
        );

        $spa = self::row(
            self::SALES_PURCHASE_AGREEMENT,
            'Sales and Purchase Agreement',
            required: false,
            help: 'Real Estate applicants only. Soft copy only. '.self::GUIDELINES,
            realEstateOnly: true,
        );

        $escrow = self::row(
            self::ESCROW_AGREEMENT,
            'Escrow Agreement',
            required: false,
            help: 'Real Estate applicants only. Soft copy only. '.self::GUIDELINES,
            realEstateOnly: true,
        );

        return [
            ApplicantType::PRINCIPAL_APPLICANT => [
                $oath, $payment, $photo, $confirmation, $spa, $escrow,
            ],
            ApplicantType::SPOUSE => [
                $oath, $photo,
            ],
            ApplicantType::DEPENDENT_16_OVER => [
                $oath, $photo,
            ],
            ApplicantType::DEPENDENT_UNDER_16 => [
                $photo,
            ],
        ];
    }

    /**
     * @return array{
     *     key: string,
     *     label: string,
     *     required: bool,
     *     help: string,
     *     folder: ?string,
     *     at_pre_approval: bool,
     *     at_post_approval: bool,
     *     carry_forward: bool,
     *     real_estate_only: bool
     * }
     */
    private static function row(
        string $key,
        string $label,
        bool $required,
        string $help,
        bool $carryForward = false,
        bool $atPreApproval = false,
        bool $realEstateOnly = false,
        ?string $folder = self::FOLDER,
    ): array {
        return [
            'key' => $key,
            'label' => $label,
            'required' => $required,
            'help' => $help,
            'folder' => $folder,
            'at_pre_approval' => $atPreApproval,
            'at_post_approval' => true,
            'carry_forward' => $carryForward,
            'real_estate_only' => $realEstateOnly,
        ];
    }
}
