<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDecisionTemplate;
use App\Models\User;

/**
 * §23. Granted and Denied letters, one pair per investment type.
 *
 * The filing subject is still {@see Notices::line}. This is the body the
 * administrator keeps: title and letter, with {{placeholders}} filled from
 * the application at send time. Missing rows fall back to the shipped
 * defaults rather than sending a blank letter.
 *
 * The shipped copy is the firm's official decision emails: Real Estate
 * Granted (24.04.2026), Granted (the other four routes), and Denial
 * (05.06.2026). "Dear …" is the postcard greeting; the letter itself starts
 * at the congratulations or denial line.
 */
class Letters
{
    /**
     * Tokens an administrator may put in a letter.
     *
     * @return list<array{token:string, meaning:string}>
     */
    public static function placeholders(): array
    {
        return [
            ['token' => 'number', 'meaning' => 'Application number, or CIP application number once assigned'],
            ['token' => 'applicant', 'meaning' => 'Main applicant’s name'],
            ['token' => 'provider', 'meaning' => 'Service provider'],
            ['token' => 'familySize', 'meaning' => 'Family size as F4'],
            ['token' => 'investmentType', 'meaning' => 'Investment type, including the Other wording'],
            ['token' => 'decisionDate', 'meaning' => 'Decision date'],
            ['token' => 'recipient', 'meaning' => 'Name of the person this copy is addressed to'],
        ];
    }

    /**
     * The ten shipped letters. firstOrCreate uses these; restore writes them
     * back. An administrator's rewording is never overwritten by a re-seed.
     *
     * @return array<string, array<string, array{title:string, body:string}>>
     */
    public static function defaults(): array
    {
        $letters = [];

        foreach (array_keys(InvestmentType::ALL) as $type) {
            $letters[$type] = [
                Status::GRANTED => [
                    'title' => '{{number}} was granted',
                    'body' => $type === InvestmentType::REAL_ESTATE
                        ? self::grantedRealEstate()
                        : self::granted(),
                ],
                Status::DENIED => [
                    'title' => '{{number}} was denied',
                    'body' => self::denied(),
                ],
            ];
        }

        return $letters;
    }

    /** Make sure all ten rows exist. Safe to call on every admin listing. */
    public static function ensure(): void
    {
        foreach (self::defaults() as $type => $outcomes) {
            foreach ($outcomes as $decision => $copy) {
                CipDecisionTemplate::query()->firstOrCreate(
                    [
                        'investment_type' => $type,
                        'decision' => $decision,
                    ],
                    [
                        'title' => $copy['title'],
                        'body' => $copy['body'],
                    ],
                );
            }
        }
    }

    public static function restore(CipDecisionTemplate $template, ?User $actor = null): CipDecisionTemplate
    {
        $copy = self::defaults()[$template->investment_type][$template->decision]
            ?? ['title' => $template->title, 'body' => $template->body];

        $template->forceFill([
            'title' => $copy['title'],
            'body' => $copy['body'],
            'updated_by' => $actor?->id,
        ])->save();

        return $template->refresh();
    }

    /**
     * The letter this application should send for this outcome.
     *
     * An unknown or empty investment type uses Other, that is the catch-all
     * the form already has, and a file with no type still has to produce a
     * letter the day it is decided.
     */
    public static function for(CipApplication $application, string $decision): CipDecisionTemplate
    {
        $type = InvestmentType::isValid($application->investment_type)
            ? $application->investment_type
            : InvestmentType::OTHER;

        $copy = self::defaults()[$type][$decision]
            ?? self::defaults()[InvestmentType::OTHER][$decision];

        return CipDecisionTemplate::query()->firstOrCreate(
            [
                'investment_type' => $type,
                'decision' => $decision,
            ],
            [
                'title' => $copy['title'],
                'body' => $copy['body'],
            ],
        );
    }

    /**
     * Title, lead and optional extra paragraphs, placeholders filled.
     *
     * The first paragraph is the centred lead (congratulations or the denial
     * line). The rest is the letter, with stage headings marked up so the
     * postcard can set them in bold.
     *
     * @return array{title:string, lead:string, bodyHtml:?string}
     */
    public static function copy(CipApplication $application, string $decision, ?string $recipientName = null): array
    {
        $template = self::for($application, $decision);
        $vars = self::vars($application, $recipientName);
        $title = self::fill($template->title, $vars);
        $paragraphs = preg_split("/\n\s*\n/", trim(self::fill($template->body, $vars))) ?: [];
        $paragraphs = array_values(array_filter(array_map('trim', $paragraphs), fn (string $p) => $p !== ''));

        $lead = $paragraphs[0] ?? '';
        $rest = array_slice($paragraphs, 1);

        return [
            'title' => $title,
            'lead' => $lead,
            'bodyHtml' => $rest === []
                ? null
                : collect($rest)->map(fn (string $p) => self::paragraphHtml($p))->implode(''),
        ];
    }

    public static function fill(string $text, array $vars): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/',
            function (array $match) use ($vars) {
                $key = $match[1];

                if (array_key_exists($key, $vars)) {
                    return (string) $vars[$key];
                }

                $camel = lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $key))));

                return array_key_exists($camel, $vars) ? (string) $vars[$camel] : $match[0];
            },
            $text,
        );
    }

    public static function isCustomized(CipDecisionTemplate $template): bool
    {
        $copy = self::defaults()[$template->investment_type][$template->decision] ?? null;

        if ($copy === null) {
            return true;
        }

        return $template->title !== $copy['title'] || $template->body !== $copy['body'];
    }

    /**
     * @return array<string, string>
     */
    public static function vars(CipApplication $application, ?string $recipientName = null): array
    {
        $facts = Contacts::facts($application);

        return [
            'number' => $facts['number'],
            'applicant' => $facts['applicant'],
            'provider' => $facts['provider'],
            'familySize' => 'F'.$facts['familySize'],
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            'decisionDate' => $application->decided_at?->format('d.m.Y')
                ?? $application->decided_at?->toDateString()
                ?? '',
            'recipient' => (string) ($recipientName ?? ''),
        ];
    }

    /**
     * The placeholder one-liners shipped before the firm’s official emails
     * were on file. A data migration matches these so a letter nobody has
     * rewritten is replaced; a letter the administrator already changed is
     * left alone.
     *
     * @return array<string, array<string, string>>
     */
    public static function previousDefaults(): array
    {
        $letters = [];

        foreach (InvestmentType::ALL as $type => $label) {
            $letters[$type] = [
                Status::GRANTED => 'The Unit has granted {{applicant}}’s application under the '.$label.' route.',
                Status::DENIED => 'The Unit has denied {{applicant}}’s application under the '.$label.' route.',
            ];
        }

        return $letters;
    }

    private static function paragraphHtml(string $p): string
    {
        $html = nl2br(e($p), false);
        $heading = (bool) preg_match(
            '/^(STAGE\s+\d|GENERAL GUIDELINES|IT[’\']S TIME TO START)/iu',
            $p,
        );

        if ($heading) {
            return '<p style="margin:20px 0 8px;font-weight:700;">'.$html.'</p>';
        }

        return '<p style="margin:0 0 12px;">'.$html.'</p>';
    }

    private static function grantedRealEstate(): string
    {
        return <<<'TEXT'
Please extend our congratulations to {{number}} – {{applicant}} on being granted citizenship of Saint Lucia.

It is important to ensure that the name above is the name you use on all your post-approval forms. It will also be the name used on all final documents – namely Certificate of Citizenship (COR), NIC Letter, and Passport.

Do find attached the official Notification Letter.

IT’S TIME TO START THE POST APPROVAL PROCESS!

Now that your application has been approved, we are ready to start the post-approval process. You may have already taken the opportunity during the application to provide some of the post-approval documents (PADs) required. If so, please disregard the sections that do not apply to you.

This process consists of three consecutive labelled stages, where each stage must be completed before advancing to the next.

Please see below the list of requirements for each party involved in the post-approval process:

STAGE 1 - CERTIFICATE OF REGISTRATION (COR) - Soft Copy ONLY

Note well that the Citizenship by Investment Unit ONLY requires soft copies for the issuance of the Certificate of Registration.

Oath of Allegiance – make sure that the Oath is signed by the applicant (16yrs and over) and a Notary OR Attorney-at-Law. The Notary OR Attorney-at-Law, whose name MUST be clearly legible, MUST stamp the document as well. Pay special attention to the date on the Oath as it cannot be before the granted date.
Proof of Payment of the Qualifying Investment – We have already provided the details on how to make the qualifying investment in the Notification Letter. Please obtain proof of payment and forward it to us at TM ANTOINE Partners Advisory.
Escrow Documents – applicable for Real Estate applications only. This includes the Letter of Confirmation, the Sales & Purchase Agreement, and the Escrow Agreement.
One digital passport-sized photo (2 inch x 2 inch)

STAGE 2 - NATIONAL INSURANCE NUMBER (NIC NUMBER) - Soft Copy ONLY

Note well that the National Insurance Corporation ONLY requires soft copies. Send us one PDF for each member of the family who is 16 and above. The PDF should include all the documents listed below. Arrange the documents in the same order listed below:

Completed R3 Form – Ensure that all applicants (16 and over) fill out the form with their accurate information. The applicant is to place their signature on the line provided for ‘Signature of applicant’. Also ensure that the Notary or Attorney-at-Law places his signature and stamp on the line provided “Signature of Witness”. (Name should be written out as well).
Certified copy of passport bio data page – Ensure that the Notary or Attorney-at-Law certifies the documents as a true copy of the original.
Certified copy of the Birth Certificate – Please ensure that the copy is notarized and certified a true copy of the original by a Notary OR an Attorney-at-Law.
Certified Copy of Name Change Document – if applicable.
Certified copy of Marriage Certificate; Divorce Decree or Death Certificate (as applicable) for female applicants ONLY.
Notarized Authorization Letter – Ensure that the applicant signs the letter and that the letter is signed and stamped by the Notary OR Attorney-at-Law.

STAGE 3 - PASSPORT - Hard Copy Originals Only

Note well that the passport office ONLY accepts hard copy original documents.

Completed ePP Form – Please ensure that the applicant signs the SIGNATURE BOX and Section 12. Section 13 is to be signed and stamped by a Notary OR Attorney-at-Law.
Original Birth Certificate OR a Certified copy from the issuing authority.
Certified copy of passport bio data page – Ensure that a Notary OR an Attorney-at-Law certifies the document as a true copy of the original.
Original Marriage Certificate – for all married women
Original Divorce Certificate – for all divorced women
Original Translations of ALL DOCUMENTS not originally in English – NB: the Passport Office will not accept the copies which were previously provided.
Four physical passport-sized photos (one must be certified on the back) (2 inch x 2 inch) - please follow the photo requirements previously sent.
Please send the physical copies of all documents to TM Antoine Partners via courier. Address - TaylorMarc Court, Rodney Bay, Gros Islet, Saint Lucia.

GENERAL GUIDELINES

Documents not written in English MUST be translated. Ensure that the translation is original, signed, and stamped by a Notary OR Attorney-at-Law.
Certified true copy of the credentials MUST be provided for the translator, Notary, and/or Attorney-at-Law who has certified or translated any of the documents listed above.

Congratulations again on the grant of citizenship. Our team will be happy to continue to assist you!

Kind regards,
TEXT;
    }

    private static function granted(): string
    {
        return <<<'TEXT'
Please extend our congratulations to {{number}} – {{applicant}} on being granted citizenship of Saint Lucia.

Please ensure the name above matches the name you use on all post-approval forms. It will also be the name used on all final documents – namely Certificate of Citizenship (COR), NIC Letter, and Passport.

Please find attached the official Notification Letter.

IT’S TIME TO START THE POST-APPROVAL PROCESS!

Now that your application has been approved, we are ready to start the post-approval process. You may have already taken the opportunity during the application to provide some of the post-approval documents (PADs) required. If so, please disregard the sections that do not apply to you.

This process consists of three consecutive labelled stages, where each stage must be completed before advancing to the next.

Please see below the list of requirements for each party involved in the post-approval process:

STAGE 1 - CERTIFICATE OF REGISTRATION (COR) - Soft Copy ONLY

Note well that the Citizenship by Investment Unit ONLY requires soft copies for the issuance of the Certificate of Registration.

1. Oath of Allegiance – make sure that the Oath is signed by the applicant (16yrs and over) and a Notary OR Attorney-at-Law. The Notary OR Attorney-at-Law, whose name MUST be clearly legible, MUST stamp the document as well. Pay special attention to the date on the Oath as it cannot be before the granted date.
2. Proof of Payment of the Qualifying Investment – We have already provided the details on how to make the qualifying investment in the Notification Letter. Please obtain proof of payment and forward it to us at TM ANTOINE Partners Advisory.
3. One digital passport-sized photo (2 inch x 2 inch)

STAGE 2 - NATIONAL INSURANCE NUMBER (NIC NUMBER) - Soft Copy ONLY

Note well that the National Insurance Corporation ONLY requires soft copies. Send us one PDF for each member of the family who is 16 and above. The PDF should include all the documents listed below. Arrange the documents in the same order listed below:

1. Completed R3 Form – Ensure that all applicants (16 and over) fill out the form with their accurate information. The applicant is to place their signature on the line provided for ‘Signature of applicant’. Also ensure that the Notary or Attorney-at-Law places his signature and stamp on the line provided “Signature of Witness”. (Name should be written out as well).
2. Certified copy of passport bio data page – Ensure that the Notary or Attorney-at-Law certifies the documents as a true copy of the original.
3. Certified copy of the Birth Certificate – Please ensure that the copy is notarized and certified a true copy of the original by a Notary OR an Attorney-at-Law.
4. Certified Copy of Name Change Document – if applicable.
5. Certified copy of Marriage Certificate; Divorce Decree or Death Certificate (as applicable) for female applicants ONLY.
6. Notarized Authorization Letter – Ensure that the applicant signs the letter and that the letter is signed and stamped by the Notary OR Attorney-at-Law.

STAGE 3 - PASSPORT - Hard Copy Originals Only

Note well that the passport office ONLY accepts hard copy original documents.

1. Completed ePP Form – Please ensure that the applicant signs the SIGNATURE BOX and Section 12. Section 13 is to be signed and stamped by a Notary OR Attorney-at-Law.
2. Original Birth Certificate OR a Certified copy from the issuing authority.
3. Certified copy of passport bio data page – Ensure that a Notary OR an Attorney-at-Law certifies the document as a true copy of the original.
4. Original Marriage Certificate – for all married women
5. Original Divorce Certificate – for all divorced women
6. Original Translations of ALL DOCUMENTS not originally in English – NB: the Passport Office will not accept the copies which were previously provided.
7. Four physical passport-sized photos (one must be certified on the back) (2 inch x 2 inch) - please follow the photo requirements previously sent.
8. Please send the physical copies of all documents to TM Antoine Partners via courier. Address - TaylorMarc Court, Rodney Bay, Gros Islet, Saint Lucia.

GENERAL GUIDELINES

1. Documents not written in English MUST be translated. Ensure that the translation is original, signed, and stamped by a Notary OR Attorney-at-Law.
2. Certified true copy of the credentials MUST be provided for the translator, Notary, and/or Attorney-at-Law who has certified or translated any of the documents listed above.

Congratulations again on the grant of citizenship. Our team will be happy to continue to assist you!

Kind regards,
TEXT;
    }

    private static function denied(): string
    {
        return <<<'TEXT'
Please be advised that the application for {{number}} – {{applicant}} has been denied.

If the applicant wishes to appeal this decision, the statutory timeframe governing Requests for Review, as outlined under Section 37(2)(b) of the Citizenship by Investment Act, No. 14 of 2015 (as amended) (the “Act”), requires that a request for review be submitted within sixty (60) days from the date of the denial letter issued by the Board.

Compliance with this statutory timeframe is mandatory. Requests for Review submitted outside the prescribed sixty (60)-day period will be considered time-barred and will not be accepted or processed by the Unit.

Please also note that there are associated fees payable to the Unit, as well as applicable fees from the Authorized Agent, for submitting a Request for Review (appeal).

Please find the Notification Letter attached for your reference.

Kind regards,
TEXT;
    }
}
