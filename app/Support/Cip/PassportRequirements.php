<?php

namespace App\Support\Cip;

/**
 * Stage 3 (Passport) document catalogue.
 *
 * Hard-copy originals only, couriered to the firm. The rows live in
 * {@see \App\Models\CipDocumentRequirement}; this is the shipped default
 * the seeder writes. Slots are still opened in the portal so staff can
 * track what was sent; the files themselves are scans of those originals.
 */
class PassportRequirements
{
    public const FOLDER = 'Passport';

    public const EPP_FORM = 'epp_form';

    public const ORIGINAL_BIRTH_CERTIFICATE = 'original_birth_certificate';

    public const CERTIFIED_PASSPORT_BIO_PAGE = 'passport_stage_bio_page';

    public const ORIGINAL_MARRIAGE_CERTIFICATE = 'original_marriage_certificate';

    public const ORIGINAL_DIVORCE_CERTIFICATE = 'original_divorce_certificate';

    public const ORIGINAL_TRANSLATIONS = 'original_translations';

    public const PHYSICAL_PASSPORT_PHOTOS = 'physical_passport_photos';

    public const COURIER = 'Please send the physical copies of all documents to TM Antoine Partners via courier. Address — TaylorMarc Court, Rodney Bay, Gros Islet, Saint Lucia.';

    public const GUIDELINES = CorRequirements::GUIDELINES.' '.self::COURIER;

    /**
     * @return list<string>
     */
    public static function keys(): array
    {
        return [
            self::EPP_FORM,
            self::ORIGINAL_BIRTH_CERTIFICATE,
            self::CERTIFIED_PASSPORT_BIO_PAGE,
            self::ORIGINAL_MARRIAGE_CERTIFICATE,
            self::ORIGINAL_DIVORCE_CERTIFICATE,
            self::ORIGINAL_TRANSLATIONS,
            self::PHYSICAL_PASSPORT_PHOTOS,
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
        $epp = self::row(
            self::EPP_FORM,
            'Completed ePP Form',
            required: true,
            help: 'The applicant signs the SIGNATURE BOX and Section 12. Section 13 is signed and stamped by a Notary or Attorney-at-Law. Hard copy original. '.self::GUIDELINES,
        );

        $birth = self::row(
            self::ORIGINAL_BIRTH_CERTIFICATE,
            'Original Birth Certificate or certified copy from the issuing authority',
            required: true,
            help: 'The original, or a certified copy from the issuing authority. Hard copy only. '.self::GUIDELINES,
        );

        $bio = self::row(
            self::CERTIFIED_PASSPORT_BIO_PAGE,
            'Certified copy of passport bio data page',
            required: true,
            help: 'A Notary or Attorney-at-Law certifies the document as a true copy of the original. Hard copy. '.self::GUIDELINES,
        );

        $marriage = self::row(
            self::ORIGINAL_MARRIAGE_CERTIFICATE,
            'Original Marriage Certificate',
            required: false,
            help: 'For married women. Hard copy original. '.self::GUIDELINES,
            femaleOnly: true,
        );

        $spouseMarriage = self::row(
            self::ORIGINAL_MARRIAGE_CERTIFICATE,
            'Original Marriage Certificate',
            required: true,
            help: 'For married women. Hard copy original. '.self::GUIDELINES,
            femaleOnly: true,
        );

        $divorce = self::row(
            self::ORIGINAL_DIVORCE_CERTIFICATE,
            'Original Divorce Certificate',
            required: false,
            help: 'For divorced women. Hard copy original. '.self::GUIDELINES,
            femaleOnly: true,
        );

        $translations = self::row(
            self::ORIGINAL_TRANSLATIONS,
            'Original translations of documents not originally in English',
            required: false,
            help: 'The Passport Office will not accept copies previously provided. Hard copy originals. '.self::GUIDELINES,
        );

        $photos = self::row(
            self::PHYSICAL_PASSPORT_PHOTOS,
            'Four physical passport-sized photos',
            required: true,
            help: '2 inch × 2 inch. One must be certified on the back. Follow the photo requirements previously sent. Hard copies. '.self::GUIDELINES,
        );

        $adult = [$epp, $birth, $bio, $marriage, $divorce, $translations, $photos];
        $child = [$epp, $birth, $bio, $translations, $photos];

        return [
            ApplicantType::PRINCIPAL_APPLICANT => $adult,
            ApplicantType::SPOUSE => [$epp, $birth, $bio, $spouseMarriage, $divorce, $translations, $photos],
            ApplicantType::DEPENDENT_16_OVER => $adult,
            ApplicantType::DEPENDENT_UNDER_16 => $child,
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
        bool $femaleOnly = false,
        ?string $folder = self::FOLDER,
    ): array {
        return [
            'key' => $key,
            'label' => $label,
            'required' => $required,
            'help' => $help,
            'folder' => $folder,
            'at_pre_approval' => false,
            'at_post_approval' => true,
            'carry_forward' => false,
            'real_estate_only' => false,
            'female_only' => $femaleOnly,
        ];
    }
}
