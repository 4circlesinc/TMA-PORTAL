<?php

namespace Database\Seeders;

use App\Models\CipDocumentRequirement;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\DocumentTypes;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * A considered default checklist — not the firm's standards.
 *
 * T.M. Antoine & Associates have not yet given us their official document
 * standards, so this ships a default set that they edit in the portal:
 * §11 names the police certificate, the medical certificate and proof of
 * address as examples, and the rest is drawn from what a citizenship
 * application ordinarily asks of each kind of person. Shipping nothing would
 * have meant every application opening with an empty checklist on the first
 * day, which reads as broken rather than unconfigured.
 *
 * Every row is written with firstOrCreate on applicant_type + key. That is the
 * whole safety of it: re-running adds only what is new, and a label, help
 * note, order or required flag the firm has since changed is never written
 * back over. Retiring one of these is a matter of clearing `active`, not
 * deleting the row — documents already filed against a requirement have to
 * keep pointing at something.
 *
 * The three intake keys are DocumentTypes' own, deliberately. Phase 2 has been
 * opening passport photo, passport bio page and birth certificate slots since
 * the intake wizard shipped; seeding the same slugs means those slots answer
 * these templates rather than sitting beside a near-identical duplicate.
 */
class CipDocumentRequirementSeeder extends Seeder
{
    public function run(): void
    {
        $added = 0;

        foreach (self::defaults() as $applicantType => $requirements) {
            foreach (array_values($requirements) as $index => $requirement) {
                $row = CipDocumentRequirement::firstOrCreate(
                    ['applicant_type' => $applicantType, 'key' => $requirement['key']],
                    [
                        // Set here rather than left to the model, so seeding
                        // does not depend on how the model makes its uuid.
                        'uuid' => (string) Str::uuid(),
                        // The three intake requirements take their wording from
                        // DocumentTypes, which is where it already lives and
                        // where the filled slots got theirs; the rest name
                        // themselves.
                        'label' => $requirement['label'] ?? DocumentTypes::label($requirement['key']),
                        'required' => $requirement['required'],
                        'help' => $requirement['help'] ?? null,
                        // Tens, so the firm can put a requirement of their own
                        // between two of ours without renumbering the list.
                        'sort_order' => ($index + 1) * 10,
                        'active' => true,
                    ],
                );

                $added += (int) $row->wasRecentlyCreated;
            }
        }

        if (Schema::hasColumn('cip_document_requirements', 'real_estate_only')) {
            $this->syncPostApproval();
        }

        $this->command?->info($added === 0
            ? 'CIP document requirements: already in place, nothing changed.'
            : "CIP document requirements: {$added} added.");
    }

    /**
     * Stage 1 COR defaults, and the phase flags the post-approval checklist
     * actually reads.
     *
     * Safe to run more than once: new COR rows are firstOrCreate, existing
     * COR rows keep an administrator's wording, and only the workflow flags
     * (phase, carry-forward, real-estate-only, folder) are brought into line
     * with the brief. Pre-approval documents that were mirrored into
     * post-approval by an earlier migration lose that Post tick unless they
     * are a COR document.
     */
    public function syncPostApproval(): void
    {
        foreach (CorRequirements::defaults() as $applicantType => $requirements) {
            foreach (array_values($requirements) as $index => $requirement) {
                $row = CipDocumentRequirement::query()
                    ->where('applicant_type', $applicantType)
                    ->where('key', $requirement['key'])
                    ->first();

                if ($row === null) {
                    CipDocumentRequirement::create([
                        'uuid' => (string) Str::uuid(),
                        'applicant_type' => $applicantType,
                        'key' => $requirement['key'],
                        'label' => $requirement['label'],
                        'required' => $requirement['required'],
                        'help' => $requirement['help'],
                        'folder' => $requirement['folder'],
                        'at_pre_approval' => $requirement['at_pre_approval'],
                        'at_post_approval' => $requirement['at_post_approval'],
                        'carry_forward' => $requirement['carry_forward'],
                        'real_estate_only' => $requirement['real_estate_only'],
                        'sort_order' => 500 + (($index + 1) * 10),
                        'active' => true,
                    ]);

                    continue;
                }

                $row->forceFill([
                    'at_pre_approval' => $requirement['at_pre_approval'] || $row->at_pre_approval,
                    'at_post_approval' => $requirement['at_post_approval'],
                    'carry_forward' => $requirement['carry_forward'],
                    'real_estate_only' => $requirement['real_estate_only'],
                    'folder' => $requirement['folder'] ?? $row->folder,
                ])->save();
            }
        }

        CipDocumentRequirement::query()
            ->whereNotIn('key', CorRequirements::keys())
            ->where(function ($query) {
                $query->where('at_post_approval', true)
                    ->orWhere('carry_forward', true)
                    ->orWhere('real_estate_only', true);
            })
            ->update([
                'at_post_approval' => false,
                'carry_forward' => false,
                'real_estate_only' => false,
            ]);
    }

    /**
     * What each kind of person owes by default.
     *
     * The lists differ because the people do. The main applicant carries the
     * weight of the application, so theirs is the longest: identity, character,
     * health, residence and the money. A spouse is admitted through the
     * marriage, which is the one document nobody else on the application can
     * produce. A dependant under sixteen owes no police certificate — no force
     * issues one for a child — and is asked instead for the consent of a parent
     * who is not on the application. At sixteen the police certificate starts,
     * which is the only reason the two dependant brackets are separate lists.
     * A sponsor is not becoming a citizen: they are never examined by a doctor,
     * and their file is identity and money.
     *
     * Marked optional are the ones that depend on a circumstance rather than on
     * who the person is — a spouse living at another address, a dependant
     * claimed as a student — because a checklist that demands a document half
     * of them cannot have teaches everyone to ignore it.
     *
     * @return array<string, array<int, array{key: string, label?: string, required: bool, help?: string}>>
     */
    private static function defaults(): array
    {
        return [
            'principal_applicant' => [
                [
                    'key' => DocumentTypes::PASSPORT_PHOTO,
                    'required' => true,
                    'help' => 'A recent colour photograph against a plain background.',
                ],
                [
                    'key' => DocumentTypes::PASSPORT_BIO_PAGE,
                    'required' => true,
                    'help' => 'The page carrying the photograph, the number and the expiry date.',
                ],
                [
                    'key' => DocumentTypes::BIRTH_CERTIFICATE,
                    'required' => true,
                    'help' => 'The long form where the country issues one, so that both parents are named.',
                ],
                [
                    'key' => 'police_certificate',
                    'label' => 'Police certificate',
                    'required' => true,
                    'help' => 'From every country lived in for more than a year over the last ten.',
                ],
                [
                    'key' => 'medical_certificate',
                    'label' => 'Medical certificate',
                    'required' => true,
                    'help' => 'Dated inside the window the programme accepts, usually three months.',
                ],
                [
                    'key' => 'proof_of_address',
                    'label' => 'Proof of address',
                    'required' => true,
                    'help' => 'A utility bill or bank statement from the last three months.',
                ],
                [
                    'key' => 'evidence_of_funds',
                    'label' => 'Evidence of funds',
                    'required' => true,
                    'help' => 'Where the investment comes from and how it was earned. Where a sponsor is funding the application, their evidence stands in place of this.',
                ],
            ],

            'spouse' => [
                [
                    'key' => DocumentTypes::PASSPORT_PHOTO,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::PASSPORT_BIO_PAGE,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::BIRTH_CERTIFICATE,
                    'required' => true,
                ],
                [
                    'key' => 'marriage_certificate',
                    'label' => 'Marriage certificate',
                    'required' => true,
                    'help' => 'What makes the spouse part of this application, with a certified translation where it is not in English.',
                ],
                [
                    'key' => 'police_certificate',
                    'label' => 'Police certificate',
                    'required' => true,
                    'help' => 'The same reach as the main applicant: every country lived in for more than a year over the last ten.',
                ],
                [
                    'key' => 'medical_certificate',
                    'label' => 'Medical certificate',
                    'required' => true,
                ],
                [
                    'key' => 'proof_of_address',
                    'label' => 'Proof of address',
                    'required' => false,
                    'help' => 'Only where the spouse lives at a different address to the main applicant.',
                ],
            ],

            'dependent_under_16' => [
                [
                    'key' => DocumentTypes::PASSPORT_PHOTO,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::PASSPORT_BIO_PAGE,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::BIRTH_CERTIFICATE,
                    'required' => true,
                    'help' => 'Names the parents, which is how the relationship to the main applicant is shown.',
                ],
                [
                    'key' => 'medical_certificate',
                    'label' => 'Medical certificate',
                    'required' => true,
                    'help' => 'Children are examined as well, though a few programmes exempt infants.',
                ],
                [
                    'key' => 'guardian_consent',
                    'label' => 'Parental consent',
                    'required' => false,
                    'help' => 'Needed where a parent or guardian with custody is not part of this application.',
                ],
            ],

            'dependent_16_over' => [
                [
                    'key' => DocumentTypes::PASSPORT_PHOTO,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::PASSPORT_BIO_PAGE,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::BIRTH_CERTIFICATE,
                    'required' => true,
                    'help' => 'Names the parents, which is how the relationship to the main applicant is shown.',
                ],
                [
                    'key' => 'police_certificate',
                    'label' => 'Police certificate',
                    'required' => true,
                    'help' => 'Most programmes begin asking at sixteen, which is why this bracket is its own list.',
                ],
                [
                    'key' => 'medical_certificate',
                    'label' => 'Medical certificate',
                    'required' => true,
                ],
                [
                    'key' => 'proof_of_enrolment',
                    'label' => 'Proof of full-time enrolment',
                    'required' => false,
                    'help' => 'Where the dependant is claimed as a student rather than as a minor child.',
                ],
            ],

            'sponsor' => [
                [
                    'key' => DocumentTypes::PASSPORT_BIO_PAGE,
                    'required' => true,
                ],
                [
                    'key' => DocumentTypes::PASSPORT_PHOTO,
                    'required' => false,
                    'help' => 'The sponsor receives no certificate, so the photograph only puts a face to the file.',
                ],
                [
                    'key' => DocumentTypes::BIRTH_CERTIFICATE,
                    'required' => true,
                    'help' => 'Identity, and the relationship where the sponsor is family.',
                ],
                [
                    'key' => 'proof_of_address',
                    'label' => 'Proof of address',
                    'required' => true,
                    'help' => 'A utility bill or bank statement from the last three months.',
                ],
                [
                    'key' => 'evidence_of_funds',
                    'label' => 'Evidence of funds',
                    'required' => true,
                    'help' => 'Where the money being invested comes from and how the sponsor came by it.',
                ],
                [
                    'key' => 'sponsorship_letter',
                    'label' => 'Sponsorship letter',
                    'required' => true,
                    'help' => 'Signed by the sponsor, naming who is being funded and to what extent.',
                ],
            ],
        ];
    }
}
