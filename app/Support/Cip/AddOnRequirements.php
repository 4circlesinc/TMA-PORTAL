<?php

namespace App\Support\Cip;

use App\Models\CipDocument;
use Illuminate\Support\Str;

/**
 * The official Add-On document checklists, one list per Add-On type.
 *
 * Transcribed from Add-On Application Management Module v1.0, section 5
 * ("Presenting Files for Add-On Review and Submission", updated 28.05.2025).
 * The rows live in {@see \App\Models\CipDocumentRequirement}; Settings is
 * the source of truth once they exist. This class is the shipped default
 * the seeder writes, the way {@see ApplicationRequirements} is for
 * pre-approval.
 *
 * Pack scans reuse the spouse / dependent keys already seeded for
 * pre-approval, so a file filed on a family application still answers the
 * same question when that person is later added as an Add-On. The Add-On
 * lane is the {@see CipDocumentRequirement::$at_add_on} tick, independent
 * of Pre and Post, which is what lets the Settings screen show the three
 * lists without rewriting the original package.
 *
 * G1 / G2 / G3 are optional supplemental slots filed in Additional
 * Documents. The brief's naming convention is `G{n} - {paper name}`;
 * empty slots keep the placeholder until a file is named. They are not
 * asked of a pre-approval spouse or dependent.
 */
class AddOnRequirements
{
    public const G1 = 'additional_document_g1';

    public const G2 = 'additional_document_g2';

    public const G3 = 'additional_document_g3';

    public const ADDITIONAL_KEYS = [
        self::G1,
        self::G2,
        self::G3,
    ];

    /**
     * The Add-On Application Folders lists, grouped by Add-On type.
     *
     * @return array<string, list<array<string, mixed>>>
     */
    public static function defaults(): array
    {
        $from = ApplicationRequirements::defaults();
        $out = [];

        foreach (AddOn::TYPES as $type) {
            $rows = [];

            foreach ($from[$type] as $requirement) {
                $rows[] = array_merge($requirement, [
                    'at_pre_approval' => true,
                    'at_post_approval' => false,
                    'at_add_on' => true,
                    'folder' => $requirement['folder'] ?? null,
                ]);
            }

            foreach (self::additionalRows() as $extra) {
                $rows[] = $extra;
            }

            $out[$type] = $rows;
        }

        return $out;
    }

    /**
     * Pack keys the brief lists for one Add-On type, without G-series extras.
     *
     * @return list<string>
     */
    public static function packKeys(string $applicantType): array
    {
        $from = ApplicationRequirements::defaults()[$applicantType] ?? [];

        return array_values(array_column($from, 'key'));
    }

    /**
     * Every key the Add-On lane asks of one type: the pack, G1–G3, and the
     * open Additional documents box every person carries on every lane.
     *
     * The box is not this brief's — it is seeded for all five applicant types
     * by {@see AdditionalDocuments} — but it is asked here, so the pruning
     * pass in the seeder must not read it as a paper the brief dropped and
     * take its Add-On tick away.
     *
     * @return list<string>
     */
    public static function keys(string $applicantType): array
    {
        return array_values(array_unique(array_merge(
            self::packKeys($applicantType),
            self::ADDITIONAL_KEYS,
            [AdditionalDocuments::KEY],
        )));
    }

    public static function isAdditional(string $key): bool
    {
        return in_array($key, self::ADDITIONAL_KEYS, true);
    }

    /** G1, G2 or G3 for a supplemental slot key. */
    public static function seriesPrefix(string $key): ?string
    {
        return match ($key) {
            self::G1 => 'G1',
            self::G2 => 'G2',
            self::G3 => 'G3',
            default => null,
        };
    }

    /**
     * `G1 - Marriage Certificate` from the slot key and the paper's name.
     *
     * The G-number comes from the slot, not the upload: dropping a file
     * already called `G1 - …` into G2 still files as G2. A bare filename
     * (`scan.pdf`) or an explicit document name becomes the second half.
     */
    public static function filedLabel(string $key, string $source): string
    {
        $prefix = self::seriesPrefix($key) ?? 'G1';
        $title = self::documentTitle($source);

        if (preg_match('/^G[123]\s*[-–—:]\s*(.+)$/u', $title, $match)) {
            $title = trim($match[1]);
        }

        if ($title === '') {
            $title = 'Additional Document Name';
        }

        return $prefix.' - '.$title;
    }

    /** The paper's name, without a path, extension, or G-prefix. */
    public static function documentTitle(string $source): string
    {
        $base = pathinfo(str_replace(['\\', '/'], '', $source), PATHINFO_FILENAME);
        $base = trim((string) preg_replace('/[\x00-\x1F\x7F]+/u', '', $base));
        $base = trim((string) preg_replace('/\s+/u', ' ', $base));
        $base = ltrim($base, '. ');

        if ($base === '') {
            return 'Additional Document Name';
        }

        return Str::limit($base, 120, '');
    }

    /**
     * The chip the Add-On Document | Status table draws for one slot.
     *
     * Section 11 gives every document its own status — Pending upload,
     * Application review, Update required, Ready for submission — rather
     * than a pack-wide Complete / Outstanding. The slot's display status is
     * that vocabulary, so this table and the person checklist cannot disagree.
     *
     * @return array{status:string,label:string,tone:string}
     */
    public static function packStatus(CipDocument $slot): array
    {
        return DocumentStatus::badge($slot->displayStatus())
            ?? DocumentStatus::badge(DocumentStatus::PENDING_UPLOAD);
    }

    /**
     * Whether this slot belongs on the Add-On Document | Status table.
     *
     * The passport photo is identity, not pack paper. Empty G-series extras
     * are unnamed supplements and stay off the table until filed.
     */
    public static function onStatusTable(CipDocument $slot): bool
    {
        if ($slot->type === DocumentTypes::PASSPORT_PHOTO) {
            return false;
        }

        if (self::isAdditional($slot->type) && ! $slot->isFilled()) {
            return false;
        }

        // An empty open box is the normal state, not an outstanding document.
        if (AdditionalDocuments::is($slot->type) && ! $slot->isFilled()) {
            return false;
        }

        return true;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function additionalRows(): array
    {
        return [
            self::additional(self::G1, 'G1 - Additional Document Name'),
            self::additional(self::G2, 'G2 - Additional Document Name'),
            self::additional(self::G3, 'G3 - Additional Document Name'),
        ];
    }

    /** @return array<string, mixed> */
    private static function additional(string $key, string $label): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'required' => false,
            'help' => 'Supplemental. Keep the G-number and replace Additional Document Name with the paper you are filing.',
            'folder' => Tree::ADDITIONAL,
            'at_pre_approval' => false,
            'at_post_approval' => false,
            'at_add_on' => true,
        ];
    }
}
