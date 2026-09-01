<?php

namespace App\Support\Cip;

/**
 * Stage 2 (National Insurance Card) document catalogue.
 *
 * Soft copies only, one pack per family member aged 16 and over. The rows
 * live in {@see \App\Models\CipDocumentRequirement}; this is the shipped
 * default the seeder writes. Birth, marriage and divorce papers marked
 * "moved" in the brief reuse the original-package slot; the rest are new
 * NIC uploads.
 */
class NicRequirements
{
    public const FOLDER = 'NIC';

    public const R3_FORM = 'r3_form';

    public const CERTIFIED_PASSPORT_BIO_PAGE = 'certified_passport_bio_page';

    public const NAME_CHANGE_DOCUMENT = 'name_change_document';

    public const DIVORCE_DECREE = 'divorce_decree';

    public const DEATH_CERTIFICATE = 'death_certificate';

    public const AUTHORIZATION_LETTER = 'nic_authorization_letter';

    public const GUIDELINES = CorRequirements::GUIDELINES;

    /**
     * @return list<string>
     */
    public static function keys(): array
    {
        return [
            self::R3_FORM,
            self::CERTIFIED_PASSPORT_BIO_PAGE,
            DocumentTypes::BIRTH_CERTIFICATE,
            self::NAME_CHANGE_DOCUMENT,
            'marriage_certificate',
            self::DIVORCE_DECREE,
            self::DEATH_CERTIFICATE,
            self::AUTHORIZATION_LETTER,
        ];
    }

    public static function owns(string $key): bool
    {
        return in_array($key, self::keys(), true);
    }

    /**
     * @return array<string, list<array{
     *     key: string,
     *     label: string,
     *     required: bool,
     *     help: string,
     *     folder: ?string,
     *     at_pre_approval: bool,
     *     at_post_approval: bool,
     *     carry_forward: bool,
     *     real_estate_only: bool,
     *     female_only: bool
     * }>>
     */
    public static function defaults(): array
    {
        $r3 = self::row(
            self::R3_FORM,
            'Completed R3 Form',
            required: true,
            help: 'Every applicant 16 and over fills this in accurately. The applicant signs on ‘Signature of applicant’. The Notary or Attorney-at-Law signs and stamps on ‘Signature of Witness’, with their name written out. Soft copies only — one PDF per person, documents in the order of this list. '.self::GUIDELINES,
        );

        $bio = self::row(
            self::CERTIFIED_PASSPORT_BIO_PAGE,
            'Certified copy of passport bio data page',
            required: true,
            help: 'The Notary or Attorney-at-Law certifies the document as a true copy of the original. Soft copy only. '.self::GUIDELINES,
        );

        $birth = self::row(
            DocumentTypes::BIRTH_CERTIFICATE,
            'Certified copy of the Birth Certificate',
            required: true,
            help: 'Notarized and certified a true copy of the original by a Notary or Attorney-at-Law. A copy already on the original package carries forward. Soft copy only. '.self::GUIDELINES,
            carryForward: true,
            atPreApproval: true,
        );

        // The original package asks for proof of a name change too, so a copy
        // filed pre-approval answers the NIC pack without a second upload.
        $nameChange = self::row(
            self::NAME_CHANGE_DOCUMENT,
            'Certified copy of name change document',
            required: false,
            help: 'If applicable. Soft copy only. '.self::GUIDELINES,
            carryForward: true,
            atPreApproval: true,
        );

        $marriage = self::row(
            'marriage_certificate',
            'Certified copy of Marriage Certificate',
            required: false,
            help: 'If applicable. Soft copy only. '.self::GUIDELINES,
        );

        // The submission guide files the marriage record and any divorce
        // decree in the principal applicant's own folder, so theirs are the
        // rows that ask pre-approval and carry forward.
        $paMarriage = self::row(
            'marriage_certificate',
            'Marriage Record or Marriage Certificate',
            required: false,
            help: 'Married applicants. A copy already on the original package carries forward. Soft copy only. '.self::GUIDELINES,
            carryForward: true,
            atPreApproval: true,
        );

        $spouseMarriage = self::row(
            'marriage_certificate',
            'Certified copy of Marriage Certificate',
            required: true,
            help: 'Notarized and certified a true copy of the original. Soft copy only. '.self::GUIDELINES,
        );

        $divorce = self::row(
            self::DIVORCE_DECREE,
            'Divorce Decree',
            required: false,
            help: 'If applicable. Soft copy only. '.self::GUIDELINES,
        );

        $paDivorce = self::row(
            self::DIVORCE_DECREE,
            'Divorce Decree',
            required: false,
            help: 'Divorced applicants. A copy already on the original package carries forward. Soft copy only. '.self::GUIDELINES,
            carryForward: true,
            atPreApproval: true,
        );

        $death = self::row(
            self::DEATH_CERTIFICATE,
            'Death Certificate',
            required: false,
            help: 'Female applicants only, where applicable. Soft copy only. '.self::GUIDELINES,
            femaleOnly: true,
        );

        $auth = self::row(
            self::AUTHORIZATION_LETTER,
            'Notarized Authorization Letter',
            required: true,
            help: 'The applicant signs the letter. A Notary or Attorney-at-Law signs and stamps it. Soft copy only. '.self::GUIDELINES,
        );

        return [
            ApplicantType::PRINCIPAL_APPLICANT => [$r3, $bio, $birth, $nameChange, $paMarriage, $paDivorce, $death, $auth],
            ApplicantType::SPOUSE => [$r3, $bio, $birth, $nameChange, $spouseMarriage, $divorce, $death, $auth],
            ApplicantType::DEPENDENT_16_OVER => [$r3, $bio, $birth, $nameChange, $marriage, $divorce, $death, $auth],
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
     *     real_estate_only: bool,
     *     female_only: bool
     * }
     */
    private static function row(
        string $key,
        string $label,
        bool $required,
        string $help,
        bool $carryForward = false,
        bool $atPreApproval = false,
        bool $femaleOnly = false,
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
            'real_estate_only' => false,
            'female_only' => $femaleOnly,
        ];
    }
}
