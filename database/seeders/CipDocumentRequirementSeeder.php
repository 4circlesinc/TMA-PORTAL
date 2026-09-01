<?php

namespace Database\Seeders;

use App\Models\CipDocumentRequirement;
use App\Support\Cip\ApplicationRequirements;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\NicRequirements;
use App\Support\Cip\PassportRequirements;
use App\Support\Cip\Requirements;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * The firm's document checklists, installed as editable rows.
 *
 * The pre-approval lists are the official "Preparing Your Files for
 * Submission" guide, transcribed in {@see ApplicationRequirements}; the
 * post-approval stages come from {@see CorRequirements},
 * {@see NicRequirements} and {@see PassportRequirements}. What ships here is
 * still only the default: Settings is the source of truth once the rows
 * exist, and the firm rewords, reorders and retires them in the portal.
 *
 * Every pre-approval row is written with firstOrCreate on applicant_type +
 * key. That is the whole safety of it: re-running adds only what is new, and
 * a label, help note, order or required flag the firm has since changed is
 * never written back over. Retiring one of these is a matter of clearing
 * `active`, not deleting the row — documents already filed against a
 * requirement have to keep pointing at something.
 *
 * The intake keys are DocumentTypes' own, deliberately. Phase 2 has been
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
     * Stage 1 COR, Stage 2 NIC and Stage 3 passport defaults, and the
     * phase flags the post-approval checklist actually reads.
     *
     * Safe to run more than once: new rows are created, existing catalogue
     * rows keep an administrator's wording, and only the workflow flags
     * (phase, carry-forward, folder, real-estate-only, female-only) are
     * brought into line with the brief. Pre-approval documents that were
     * mirrored into post-approval by an earlier migration lose that Post
     * tick unless they belong to COR, NIC or Passport.
     */
    public function syncPostApproval(): void
    {
        $this->syncCatalogue(CorRequirements::defaults(), 500);
        $this->syncCatalogue(NicRequirements::defaults(), 600);
        $this->syncCatalogue(PassportRequirements::defaults(), 700);

        $keep = array_values(array_unique(array_merge(
            CorRequirements::keys(),
            NicRequirements::keys(),
            PassportRequirements::keys(),
        )));

        $clear = [
            'at_post_approval' => false,
            'carry_forward' => false,
            'real_estate_only' => false,
        ];

        if (Schema::hasColumn('cip_document_requirements', 'female_only')) {
            $clear['female_only'] = false;
        }

        CipDocumentRequirement::query()
            ->whereNotIn('key', $keep)
            ->where(function ($query) {
                $query->where('at_post_approval', true)
                    ->orWhere('carry_forward', true)
                    ->orWhere('real_estate_only', true);

                if (Schema::hasColumn('cip_document_requirements', 'female_only')) {
                    $query->orWhere('female_only', true);
                }
            })
            ->update($clear);
    }

    /**
     * @param  array<string, list<array<string, mixed>>>  $defaults
     */
    private function syncCatalogue(array $defaults, int $orderBase): void
    {
        $hasFemale = Schema::hasColumn('cip_document_requirements', 'female_only');

        foreach ($defaults as $applicantType => $requirements) {
            foreach (array_values($requirements) as $index => $requirement) {
                $sortOrder = $orderBase + (($index + 1) * 10);
                $row = CipDocumentRequirement::query()
                    ->where('applicant_type', $applicantType)
                    ->where('key', $requirement['key'])
                    ->first();

                $flags = [
                    'at_pre_approval' => $requirement['at_pre_approval'],
                    'at_post_approval' => $requirement['at_post_approval'],
                    'carry_forward' => $requirement['carry_forward'],
                    'real_estate_only' => $requirement['real_estate_only'],
                    'folder' => $requirement['folder'],
                ];

                if ($hasFemale) {
                    $flags['female_only'] = (bool) ($requirement['female_only'] ?? false);
                }

                if ($row === null) {
                    CipDocumentRequirement::create(array_merge([
                        'uuid' => (string) Str::uuid(),
                        'applicant_type' => $applicantType,
                        'key' => $requirement['key'],
                        'label' => $requirement['label'],
                        'required' => $requirement['required'],
                        'help' => $requirement['help'],
                        'sort_order' => $sortOrder,
                        'active' => true,
                    ], $flags));

                    continue;
                }

                if ($row->sort_order < $orderBase) {
                    $flags['sort_order'] = $sortOrder;
                }

                $flags['at_pre_approval'] = $requirement['at_pre_approval'] || $row->at_pre_approval;

                $row->forceFill($flags)->save();
            }
        }
    }

    /**
     * Install the official pre-approval lists over whatever is in place.
     *
     * The one deliberately forceful pass, run once from a migration rather
     * than on every seed: until the official guide arrived, the table held a
     * considered placeholder set, and the firm's own wording is the edit that
     * placeholder was always waiting for. Labels, required flags and official
     * help are written over; a help note the guide does not replace is kept;
     * and a row's post-approval flags (pack, folder, real-estate, female-only)
     * are never touched from here.
     *
     * Rows the guide does not list are retired through
     * {@see Requirements::retire()}, which keeps every document already filed
     * against them. And the marriage record moves where the guide files it —
     * the principal applicant's folder, not the spouse's — so the spouse's
     * copy stops being asked pre-approval while staying a required NIC upload.
     *
     * Sort orders: official rows take the guide's order in tens; a row a
     * post-approval sync has already ordered into its pack (500 and up) keeps
     * that place, the same bargain the birth certificate already lives with.
     */
    public function installOfficialPreApproval(): void
    {
        foreach (ApplicationRequirements::defaults() as $applicantType => $requirements) {
            foreach (array_values($requirements) as $index => $requirement) {
                $row = CipDocumentRequirement::withTrashed()
                    ->where('applicant_type', $applicantType)
                    ->where('key', $requirement['key'])
                    ->first();

                $official = [
                    'label' => $requirement['label'],
                    'required' => $requirement['required'],
                    'help' => $requirement['help'] ?? $row?->help,
                    'active' => true,
                    'at_pre_approval' => true,
                    'carry_forward' => ($requirement['carry_forward'] ?? false) || (bool) $row?->carry_forward,
                    'sort_order' => ($row === null || $row->sort_order < 500)
                        ? ($index + 1) * 10
                        : $row->sort_order,
                ];

                if ($row === null) {
                    CipDocumentRequirement::create(array_merge([
                        'uuid' => (string) Str::uuid(),
                        'applicant_type' => $applicantType,
                        'key' => $requirement['key'],
                    ], $official));

                    continue;
                }

                if ($row->trashed()) {
                    $row->restore();
                }

                $row->forceFill($official)->save();
            }
        }

        // The guide files the marriage record in the principal applicant's
        // folder; the spouse's NIC copy stays, but stops being asked (and
        // carried) pre-approval.
        CipDocumentRequirement::query()
            ->where('applicant_type', 'spouse')
            ->where('key', 'marriage_certificate')
            ->first()
            ?->forceFill(['at_pre_approval' => false, 'carry_forward' => false])
            ->save();

        foreach (ApplicationRequirements::withdrawn() as [$applicantType, $key]) {
            $row = CipDocumentRequirement::query()
                ->where('applicant_type', $applicantType)
                ->where('key', $key)
                ->where('active', true)
                ->first();

            if ($row) {
                Requirements::retire($row);
            }
        }
    }

    /**
     * The official pre-approval lists, in seeding shape.
     *
     * {@see ApplicationRequirements} is the transcription of the firm's guide
     * and the place to read about the merges and conditions; this method only
     * exists so run() keeps its one loop.
     *
     * @return array<string, array<int, array{key: string, label?: string, required: bool, help?: string}>>
     */
    private static function defaults(): array
    {
        return ApplicationRequirements::defaults();
    }
}
