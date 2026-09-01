<?php

namespace App\Support\Cip;

/**
 * The firm's official pre-approval document checklists.
 *
 * Transcribed from "Preparing Your Files for Submission" (updated 28.05.2025),
 * the Application Folders section: one list per kind of person, in the order
 * the guide prints them. The rows themselves live in
 * {@see \App\Models\CipDocumentRequirement} — Settings is the source of truth
 * once they exist — and this class is the shipped default the seeder writes,
 * the way {@see CorRequirements}, {@see NicRequirements} and
 * {@see PassportRequirements} already are for the post-approval stages.
 *
 * The guide prints two principal-applicant lists, Single and Married. The
 * module keys checklists on {@see ApplicantType}'s five values and marital
 * status is not one of them, so the two lists are merged: everything either
 * prints is here, and the rows only one of them prints — the marriage record,
 * the divorce decree, the special affidavit for a single applicant's adult
 * dependent — are optional, with the condition stated in the help. That is
 * also how the guide treats its own RED entries ("ONLY if they are
 * applicable"), which map to `required: false` throughout.
 *
 * Rows whose keys the NIC stage also owns (the birth record, proof of name
 * change, and the principal applicant's marriage and divorce papers) mark
 * `carry_forward`, so what was filed on the original package answers the
 * post-approval pack without being uploaded twice — the arrangement
 * {@see NicRequirements} describes from its side.
 *
 * The guide's G-series ("Additional Document Name") is a naming convention
 * for extras, not a requirement, so it seeds nothing: an administrator adds
 * ad-hoc rows in Settings when a file needs one.
 */
class ApplicationRequirements
{
    /**
     * The official Application Folders lists, grouped by applicant type.
     *
     * @return array<string, list<array{key: string, label: string, required: bool, help?: string, carry_forward?: bool}>>
     */
    public static function defaults(): array
    {
        return [
            ApplicantType::PRINCIPAL_APPLICANT => [
                ['key' => 'sl1_form', 'label' => 'SL1 Form', 'required' => true],
                ['key' => 'sl2a_form', 'label' => 'SL2A Form', 'required' => true],
                ['key' => 'sl3_form', 'label' => 'SL3 Form', 'required' => true],
                ['key' => 'sl4_form', 'label' => 'SL4 Form', 'required' => true],
                ['key' => 'affidavit_of_support', 'label' => 'Affidavit of Support (Formerly SL7a)', 'required' => true],
                ['key' => DocumentTypes::BIRTH_CERTIFICATE, 'label' => 'Certified Copy of Birth Record', 'required' => true],
                ['key' => 'name_change_document', 'label' => 'Certified Copy of Proof of Change of Name', 'required' => false, 'help' => 'Only where a name has changed.', 'carry_forward' => true],
                ['key' => 'citizenship_certificate', 'label' => 'Certified Copy of Certificate of Citizenship', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'permanent_resident_card', 'label' => 'Certified Copy of Permanent Resident Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'national_id_card', 'label' => 'Certified Copy of National ID Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_BIO_PAGE, 'label' => 'Certified Copy of Passport Bio Data Page', 'required' => true],
                ['key' => 'valid_expired_visas', 'label' => 'Certified Copy of Valid and Expired Visas', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'apostille_copy', 'label' => 'Copy of Apostille', 'required' => false, 'help' => 'Only if applicable.'],
                ['key' => 'special_affidavit_over_18', 'label' => 'Special Affidavit of Support for Dependents over the age of 18', 'required' => false, 'help' => 'Single applicants with a dependent over 18.'],
                ['key' => DocumentTypes::PASSPORT_PHOTO, 'label' => 'Scanned Copy of a Passport-Sized Photo (JPEG or PNG & PDF)', 'required' => true],
                ['key' => 'proof_of_address', 'label' => 'Original Proof of Address', 'required' => true],
                ['key' => 'marriage_certificate', 'label' => 'Marriage Record or Marriage Certificate', 'required' => false, 'help' => 'Married applicants.', 'carry_forward' => true],
                ['key' => 'divorce_decree', 'label' => 'Divorce Decree', 'required' => false, 'help' => 'Divorced applicants.', 'carry_forward' => true],
                ['key' => 'police_certificate', 'label' => 'Original Police Certificate(s)', 'required' => true, 'help' => 'From every country lived in for more than a year over the last ten.'],
                ['key' => 'custody_records', 'label' => 'Custody or Legal Guardianship Records', 'required' => false, 'help' => 'Only if applicable.'],
                ['key' => 'non_accompanying_parent_declaration', 'label' => 'Statutory Declaration of Non-Accompanying Parent', 'required' => false, 'help' => 'Only where a parent is not accompanying.'],
                ['key' => 'non_accompanying_parent_id', 'label' => 'Photo ID of a Non-Accompanying Parent', 'required' => false, 'help' => 'Only where a parent is not accompanying.'],
                ['key' => 'military_record', 'label' => 'Certified Copy of Military Record', 'required' => false, 'help' => 'Only where the applicant has served.'],
                ['key' => 'curriculum_vitae', 'label' => 'Original Curriculum Vitae', 'required' => true],
                ['key' => 'professional_academic_certificates', 'label' => 'Certified Copy of Professional and Academic Certificates', 'required' => true],
                ['key' => 'bank_reference_letter', 'label' => 'Original Bank Reference Letter', 'required' => true],
                ['key' => 'net_worth_breakdown', 'label' => 'Original Net Worth Breakdown', 'required' => true],
                ['key' => 'translator_credentials', 'label' => "Certified Copy of Translator's Credentials", 'required' => true, 'help' => 'For any translated document.'],
                ['key' => 'notary_credentials', 'label' => "Certified Copy of Notary's Credentials", 'required' => true],
                ['key' => 'attorney_credentials', 'label' => "Certified Copy of Attorney-at-Law's Credentials", 'required' => true],
                ['key' => 'credentials_apostille', 'label' => 'Apostille for Attorney-at-Law & Notary Credentials', 'required' => true],
            ],

            ApplicantType::SPOUSE => [
                ['key' => 'sl1_form', 'label' => 'SL1 Form', 'required' => true],
                ['key' => 'sl2b_form', 'label' => 'SL2B Form', 'required' => true],
                ['key' => 'sl3_form', 'label' => 'SL3 Form', 'required' => true],
                ['key' => DocumentTypes::BIRTH_CERTIFICATE, 'label' => 'Certified Copy of Birth Record', 'required' => true],
                ['key' => 'name_change_document', 'label' => 'Certified Copy of Proof of Name Change', 'required' => false, 'help' => 'Only where a name has changed.', 'carry_forward' => true],
                ['key' => 'citizenship_certificate', 'label' => 'Certified Copy of Certificate of Citizenship', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'permanent_resident_card', 'label' => 'Certified Copy of Permanent Resident Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'national_id_card', 'label' => 'Certified Copy of National ID Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_BIO_PAGE, 'label' => 'Certified Copy of Passport Bio Data Page', 'required' => true],
                ['key' => 'valid_expired_visas', 'label' => 'Certified Copy of Valid and Expired Visas', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_PHOTO, 'label' => 'Scanned Copy of a Passport-Sized Photo (JPEG or PNG & PDF)', 'required' => true],
                ['key' => 'police_certificate', 'label' => 'Original Police Certificate(s)', 'required' => true, 'help' => 'The same reach as the principal applicant: every country lived in for more than a year over the last ten.'],
                ['key' => 'military_record', 'label' => 'Certified Copy of Military Record', 'required' => false, 'help' => 'Only where the spouse has served.'],
                ['key' => 'curriculum_vitae', 'label' => 'Original Curriculum Vitae', 'required' => true],
                ['key' => 'professional_academic_certificates', 'label' => 'Certified Copy of Professional and Academic Certificates', 'required' => true],
            ],

            ApplicantType::DEPENDENT_UNDER_16 => [
                ['key' => 'sl1_form', 'label' => 'SL1 Form', 'required' => true],
                ['key' => 'sl2b_form', 'label' => 'SL2B Form', 'required' => true],
                ['key' => 'sl3_form', 'label' => 'SL3 Form', 'required' => true],
                ['key' => DocumentTypes::BIRTH_CERTIFICATE, 'label' => 'Certified Copy of Birth Record', 'required' => true],
                ['key' => 'name_change_document', 'label' => 'Certified Copy of Proof of Name Change', 'required' => false, 'help' => 'Only where a name has changed.'],
                ['key' => 'citizenship_certificate', 'label' => 'Certified Copy of Certificate of Citizenship', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'permanent_resident_card', 'label' => 'Certified Copy of Permanent Resident Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'national_id_card', 'label' => 'Certified Copy of National ID Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_BIO_PAGE, 'label' => 'Certified Copy of Passport Bio Data Page', 'required' => true],
                ['key' => 'valid_expired_visas', 'label' => 'Certified Copy of Valid and Expired Visas', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_PHOTO, 'label' => 'Scanned Copy of a Passport-Sized Photo', 'required' => true],
            ],

            ApplicantType::DEPENDENT_16_OVER => [
                ['key' => 'sl1_form', 'label' => 'SL1 Form', 'required' => true],
                ['key' => 'sl2b_form', 'label' => 'SL2B Form', 'required' => true],
                ['key' => 'sl3_form', 'label' => 'SL3 Form', 'required' => true],
                ['key' => DocumentTypes::BIRTH_CERTIFICATE, 'label' => 'Certified Copy of Birth Record', 'required' => true],
                ['key' => 'name_change_document', 'label' => 'Certified Copy of Proof of Name Change', 'required' => false, 'help' => 'Only where a name has changed.', 'carry_forward' => true],
                ['key' => 'citizenship_certificate', 'label' => 'Certified Copy of Certificate of Citizenship', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'permanent_resident_card', 'label' => 'Certified Copy of Permanent Resident Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'national_id_card', 'label' => 'Certified Copy of National ID Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_BIO_PAGE, 'label' => 'Certified Copy of Passport Bio Data Page', 'required' => true],
                ['key' => 'valid_expired_visas', 'label' => 'Certified Copy of Valid and Expired Visas', 'required' => false, 'help' => 'Only if held.'],
                ['key' => DocumentTypes::PASSPORT_PHOTO, 'label' => 'Scanned Copy of a Passport-Sized Photo (JPEG or PNG & PDF)', 'required' => true],
                ['key' => 'police_certificate', 'label' => 'Original Police Certificate', 'required' => true, 'help' => 'Asked of dependents from sixteen.'],
                ['key' => 'military_record', 'label' => 'Certified Copy of Military Record', 'required' => false, 'help' => 'Only where the dependent has served.'],
                ['key' => 'curriculum_vitae', 'label' => 'Original Curriculum Vitae', 'required' => false, 'help' => 'Only for dependents 18 and older.'],
                ['key' => 'professional_academic_certificates', 'label' => 'Certified Copy of Professional and Academic Certificates', 'required' => true],
            ],

            ApplicantType::SPONSOR => [
                ['key' => 'bank_reference_letter', 'label' => 'Original Bank Reference', 'required' => true],
                ['key' => 'police_certificate', 'label' => 'Original Police Certificate from Country of Birth', 'required' => true],
                ['key' => 'police_certificates_residence', 'label' => 'Original Police Certificates from Countries of Residence', 'required' => true, 'help' => 'Any country lived in for more than a year over the last ten.'],
                ['key' => 'sponsorship_letter', 'label' => "Sponsor's Affidavit", 'required' => true, 'help' => 'States the profession and place of work, ten years of residential addresses, companies held at 20% or more or directed, the relationship to the applicant, the reason for sponsoring, that the sponsor pays all costs of the application, and their annual income and net worth.'],
                ['key' => 'curriculum_vitae', 'label' => 'Original Curriculum Vitae', 'required' => true],
                ['key' => DocumentTypes::PASSPORT_BIO_PAGE, 'label' => 'Certified Copy of the Passport Bio Data Page', 'required' => true],
                ['key' => DocumentTypes::BIRTH_CERTIFICATE, 'label' => 'Certified Copy of Birth Certificate', 'required' => true],
                ['key' => 'national_id_card', 'label' => 'Certified Copy of National Identification Card', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'name_change_document', 'label' => 'Certified Copy of Deed Poll or Change of Name Document', 'required' => false, 'help' => 'Only where a name has changed.'],
                ['key' => 'citizenship_certificate', 'label' => 'Certified Copy of Citizenship Certificate', 'required' => false, 'help' => 'Only if held.'],
                ['key' => 'permanent_resident_card', 'label' => 'Certified Copy of Resident Card or Permit', 'required' => false, 'help' => 'Only if held.'],
            ],
        ];
    }

    /**
     * The considered-default rows the official guide does not ask for.
     *
     * These shipped before the firm's standards arrived and are retired, not
     * deleted, when the official list is installed: documents already filed
     * against them keep their label, their history and their meaning, exactly
     * as {@see Requirements::retire()} promises. The sponsor's photo is here
     * too — the intake wizard still collects one for the person's profile
     * picture, but the guide's sponsor folder does not list it.
     *
     * @return list<array{0: string, 1: string}> [applicant_type, key] pairs
     */
    public static function withdrawn(): array
    {
        return [
            [ApplicantType::PRINCIPAL_APPLICANT, 'medical_certificate'],
            [ApplicantType::PRINCIPAL_APPLICANT, 'evidence_of_funds'],
            [ApplicantType::SPOUSE, 'medical_certificate'],
            [ApplicantType::SPOUSE, 'proof_of_address'],
            [ApplicantType::DEPENDENT_UNDER_16, 'medical_certificate'],
            [ApplicantType::DEPENDENT_UNDER_16, 'guardian_consent'],
            [ApplicantType::DEPENDENT_16_OVER, 'medical_certificate'],
            [ApplicantType::DEPENDENT_16_OVER, 'proof_of_enrolment'],
            [ApplicantType::SPONSOR, DocumentTypes::PASSPORT_PHOTO],
            [ApplicantType::SPONSOR, 'proof_of_address'],
            [ApplicantType::SPONSOR, 'evidence_of_funds'],
        ];
    }
}
