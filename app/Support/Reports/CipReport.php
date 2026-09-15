<?php

namespace App\Support\Reports;

use App\Models\CipApplicationAssignment;
use App\Models\CipPerson;
use App\Models\Report;
use App\Support\Cip\AddOn;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Pages;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CIP application reports (section 25 / Add-On section 19).
 *
 * One builder. Pre-approval keeps its seven named presets; Add-On adds its
 * own status and grouping presets. The filters are the brief's list — status,
 * Add-On type, main / Add-On applicant, assigned officer, submission and
 * decision dates, date range, CIP number, COR number — and the named
 * examples are those filters already filled in. Numbers come from
 * `cip_applications` itself, including withdrawn rows, so a historical grant
 * still counts after the file left the live table.
 */
final class CipReport
{
    /** Preset => the status it pins, or null when it is a grouping. */
    public const PRESETS = [
        'pending_review' => Status::PENDING_REVIEW,
        'background_check' => Status::BACKGROUND_CHECK,
        'delayed' => Status::DELAYED,
        'granted' => Status::GRANTED,
        'denied' => Status::DENIED,
        'by_provider' => null,
        'by_investment_type' => null,
        'addon_new' => Status::NEW,
        'addon_pending_review' => Status::PENDING_REVIEW,
        'addon_assessment_feedback' => Status::ASSESSMENT_FEEDBACK,
        'addon_non_compliant' => Status::NON_COMPLIANT,
        'addon_granted' => Status::GRANTED,
        'addon_denied' => Status::DENIED,
        'addon_by_relationship' => null,
        'addon_by_officer' => null,
    ];

    public const PRESET_LABELS = [
        'pending_review' => 'Applications Pending Review',
        'background_check' => 'Applications in Background Check',
        'delayed' => 'Delayed Applications',
        'granted' => 'Granted Applications',
        'denied' => 'Denied Applications',
        'by_provider' => 'Applications by Service Provider',
        'by_investment_type' => 'Applications by Investment Type',
        'addon_new' => 'New Add-On Applications',
        'addon_pending_review' => 'Pending Reviews',
        'addon_assessment_feedback' => 'Assessment Feedback Cases',
        'addon_non_compliant' => 'Non-Compliant Cases',
        'addon_granted' => 'Approved Add-Ons',
        'addon_denied' => 'Denied Add-Ons',
        'addon_by_relationship' => 'Add-Ons by Relationship Type',
        'addon_by_officer' => 'Add-Ons by Assigned Officer',
    ];

    /** Rows kept on the stored table, enough for a sitting, not a dump of the legacy book. */
    private const LIST_CAP = 2000;

    /**
     * @return array{metrics: list<array<string, mixed>>, table: array{title: string, columns: list<string>, rows: list<list<string>>}}
     */
    public static function build(Report $report, Carbon $from, Carbon $to): array
    {
        $filters = is_array($report->filters) ? $report->filters : [];
        $base = self::filtered($filters, $report->range_key, $from, $to);
        $addOn = self::isAddOnScope($filters);

        $total = self::tally($base);
        $hint = $total === 1 ? 'application' : 'applications';

        $metrics = $addOn
            ? [
                self::metric('Applications', $total, $hint),
                self::metric('New', self::tally((clone $base)->where('a.status', Status::NEW))),
                self::metric('Pending Review', self::tally((clone $base)->where('a.status', Status::PENDING_REVIEW))),
                self::metric('Assessment Feedback', self::tally((clone $base)->where('a.status', Status::ASSESSMENT_FEEDBACK))),
                self::metric('Non-compliant', self::tally((clone $base)->where('a.status', Status::NON_COMPLIANT))),
                self::metric('Approved', self::tally((clone $base)->where('a.status', Status::GRANTED))),
                self::metric('Denied', self::tally((clone $base)->where('a.status', Status::DENIED))),
            ]
            : [
                self::metric('Applications', $total, $hint),
                self::metric('Pending Review', self::tally((clone $base)->where('a.status', Status::PENDING_REVIEW))),
                self::metric('Background Check', self::tally((clone $base)->where('a.status', Status::BACKGROUND_CHECK))),
                self::metric('Delayed', self::tally((clone $base)->where('a.status', Status::DELAYED))),
                self::metric('Granted', self::tally((clone $base)->where('a.status', Status::GRANTED))),
                self::metric('Denied', self::tally((clone $base)->where('a.status', Status::DENIED))),
            ];

        $preset = $filters['preset'] ?? null;

        $table = match ($preset) {
            'by_provider' => self::grouped($base, 'p.name', 'Service provider', 'Applications by Service Provider'),
            'by_investment_type' => self::grouped($base, 'a.investment_type', 'Investment type', 'Applications by Investment Type'),
            'addon_by_relationship' => self::grouped($base, 'pe.relationship', 'Relationship', 'Add-Ons by Relationship Type'),
            'addon_by_officer' => self::grouped($base, 'o.name', 'Assigned officer', 'Add-Ons by Assigned Officer'),
            default => self::listing($base, $total, $addOn),
        };

        return [
            'metrics' => $metrics,
            'table' => $table,
        ];
    }

    public static function title(array $filters, string $rangeLabel): string
    {
        $preset = (string) ($filters['preset'] ?? '');
        $head = self::PRESET_LABELS[$preset] ?? 'CIP Applications';

        return $head.': '.$rangeLabel;
    }

    public static function isAddOnPreset(?string $preset): bool
    {
        return is_string($preset) && str_starts_with($preset, 'addon_');
    }

    /* ── the question ───────────────────────────────────────────────── */

    private static function filtered(array $filters, string $rangeKey, Carbon $from, Carbon $to): Builder
    {
        $applicants = DB::table('cip_people')
            ->where('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->select(
                'application_id',
                DB::raw(self::personNameSql().' as name'),
                'relationship',
            );

        $parentApplicants = DB::table('cip_people')
            ->where('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->select(
                'application_id',
                DB::raw(self::personNameSql().' as name'),
            );

        $query = DB::table('cip_applications as a')
            ->leftJoin('cip_providers as p', 'p.id', '=', 'a.provider_id')
            ->leftJoin('users as o', 'o.id', '=', 'a.assigned_officer_id')
            ->leftJoin('clients as c', 'c.id', '=', 'a.client_id')
            ->leftJoin('cip_applications as parent', 'parent.id', '=', 'a.parent_application_id')
            ->leftJoinSub($applicants, 'pe', 'pe.application_id', '=', 'a.id')
            ->leftJoinSub($parentApplicants, 'ppe', 'ppe.application_id', '=', 'a.parent_application_id');

        $status = self::status($filters);

        if ($status !== null) {
            $query->where('a.status', $status);
        } else {
            // Leftover DRAFT rows are not a live status. Admin buckets do not
            // name them, and an unfiltered report must not either.
            $query->where('a.status', '!=', Status::DRAFT);
        }

        $phase = self::phase($filters);

        if ($phase !== null) {
            $query->where('a.phase', $phase);
        }

        if (! empty($filters['providerId'])) {
            $query->where('a.provider_id', (int) $filters['providerId']);
        }

        if (! empty($filters['investmentType'])) {
            $query->where('a.investment_type', $filters['investmentType']);
        }

        if (! empty($filters['addonType']) && in_array($filters['addonType'], AddOn::TYPES, true)) {
            $query->where('a.addon_type', $filters['addonType']);
        }

        if (! empty($filters['officerId'])) {
            $officerId = (int) $filters['officerId'];
            $query->where(function (Builder $q) use ($officerId) {
                $q->where('a.assigned_officer_id', $officerId)
                    ->orWhereExists(function ($sub) use ($officerId) {
                        $sub->from('cip_application_assignments')
                            ->whereColumn('cip_application_assignments.application_id', 'a.id')
                            ->where('cip_application_assignments.user_id', $officerId)
                            ->where('cip_application_assignments.status', CipApplicationAssignment::STATUS_ACTIVE)
                            ->whereNull('cip_application_assignments.ended_at');
                    });
            });
        }

        $applicant = trim((string) ($filters['applicant'] ?? ''));

        if ($applicant !== '') {
            $like = '%'.self::escapeLike($applicant).'%';
            $query->where('pe.name', 'like', $like);
        }

        $mainApplicant = trim((string) ($filters['mainApplicant'] ?? ''));

        if ($mainApplicant !== '') {
            $like = '%'.self::escapeLike($mainApplicant).'%';
            $query->where(function (Builder $q) use ($like) {
                $q->where(function (Builder $inner) use ($like) {
                    $inner->where('a.phase', Phase::ADD_ON)
                        ->where('ppe.name', 'like', $like);
                })->orWhere(function (Builder $inner) use ($like) {
                    $inner->where(function (Builder $phase) {
                        $phase->whereNull('a.phase')
                            ->orWhere('a.phase', '!=', Phase::ADD_ON);
                    })->where('pe.name', 'like', $like);
                });
            });
        }

        $addonApplicant = trim((string) ($filters['addonApplicant'] ?? ''));

        if ($addonApplicant !== '') {
            $like = '%'.self::escapeLike($addonApplicant).'%';
            $query->where('a.phase', Phase::ADD_ON)
                ->where('pe.name', 'like', $like);
        }

        $cipNumber = self::normalizeNumber((string) ($filters['cipNumber'] ?? ''));

        if ($cipNumber !== '') {
            $query->where(function (Builder $q) use ($cipNumber) {
                $q->whereRaw(self::numberMatchSql('a.cip_number'), [$cipNumber])
                    ->orWhereRaw(self::numberMatchSql('parent.cip_number'), [$cipNumber]);
            });
        }

        $corNumber = self::normalizeNumber((string) ($filters['corNumber'] ?? ''));

        if ($corNumber !== '') {
            $query->where(function (Builder $q) use ($corNumber) {
                $q->whereRaw(self::numberMatchSql('a.cor_number'), [$corNumber])
                    ->orWhereRaw(self::numberMatchSql('parent.cor_number'), [$corNumber]);
            });
        }

        if (! empty($filters['submittedFrom'])) {
            $query->whereDate('a.submitted_at', '>=', $filters['submittedFrom']);
        }

        if (! empty($filters['submittedTo'])) {
            $query->whereDate('a.submitted_at', '<=', $filters['submittedTo']);
        }

        if (! empty($filters['decidedFrom'])) {
            $query->whereDate('a.decided_at', '>=', $filters['decidedFrom']);
        }

        if (! empty($filters['decidedTo'])) {
            $query->whereDate('a.decided_at', '<=', $filters['decidedTo']);
        }

        if ($rangeKey !== 'all') {
            $column = in_array($status, [Status::GRANTED, Status::DENIED], true)
                ? 'a.decided_at'
                : 'a.created_at';

            if ($column === 'a.decided_at') {
                $query->whereDate('a.decided_at', '>=', $from->toDateString())
                    ->whereDate('a.decided_at', '<=', $to->toDateString());
            } else {
                $query->whereBetween('a.created_at', [$from, $to]);
            }
        }

        return $query;
    }

    private static function status(array $filters): ?string
    {
        $preset = (string) ($filters['preset'] ?? '');
        $pinned = $preset !== '' ? (self::PRESETS[$preset] ?? null) : null;

        if ($pinned) {
            return $pinned;
        }

        if (! empty($filters['status']) && Status::isValid($filters['status'])) {
            return $filters['status'];
        }

        return null;
    }

    private static function phase(array $filters): ?string
    {
        if (self::isAddOnPreset($filters['preset'] ?? null)) {
            return Phase::ADD_ON;
        }

        $phase = (string) ($filters['phase'] ?? '');

        return Phase::isValid($phase) ? $phase : null;
    }

    private static function isAddOnScope(array $filters): bool
    {
        return self::isAddOnPreset($filters['preset'] ?? null)
            || (($filters['phase'] ?? null) === Phase::ADD_ON);
    }

    /* ── answers ────────────────────────────────────────────────────── */

    private static function listing(Builder $base, int $total, bool $addOn): array
    {
        $rows = (clone $base)
            ->orderByDesc('a.id')
            ->limit(self::LIST_CAP)
            ->get([
                'a.internal_number',
                'a.cip_number',
                'a.cor_number',
                'a.phase',
                'a.addon_type',
                'pe.name as applicant',
                'pe.relationship as relationship',
                'ppe.name as parent_applicant',
                'parent.cip_number as parent_cip_number',
                'parent.cor_number as parent_cor_number',
                'a.status',
                'p.name as provider',
                'a.investment_type',
                'a.investment_type_other',
                'o.name as officer',
                'a.submitted_at',
                'a.decided_at',
                'c.uid as client_uid',
            ]);

        $listed = $rows->count();
        $title = $addOn ? 'Add-On applications' : 'Applications';
        if ($listed < $total) {
            $title .= ' (first '.self::number($listed).' of '.self::number($total).')';
        }

        if ($addOn) {
            return [
                'title' => $title,
                'columns' => [
                    'Number', 'Add-On applicant', 'Main applicant', 'Add-On type',
                    'Status', 'Assigned officer', 'CIP number', 'COR number',
                    'Submitted', 'Decision date',
                ],
                'rows' => $rows->map(fn ($row) => [
                    $row->internal_number ?? '',
                    trim((string) $row->applicant) !== '' ? trim((string) $row->applicant) : '-',
                    trim((string) $row->parent_applicant) !== '' ? trim((string) $row->parent_applicant) : '-',
                    AddOn::typeLabel($row->addon_type) ?: '-',
                    Status::label((string) $row->status),
                    $row->officer ?: '-',
                    $row->parent_cip_number ?: ($row->cip_number ?: '-'),
                    $row->parent_cor_number ?: ($row->cor_number ?: '-'),
                    self::day($row->submitted_at),
                    self::day($row->decided_at),
                ])->all(),
                'rowHrefs' => $rows->map(function ($row) {
                    $uid = trim((string) ($row->client_uid ?? ''));

                    return $uid !== '' ? Pages::application($uid) : '';
                })->all(),
            ];
        }

        return [
            'title' => $title,
            'columns' => ['Number', 'Applicant', 'Status', 'Service provider', 'Investment type', 'Assigned officer', 'Submitted', 'Decision date'],
            'rows' => $rows->map(fn ($row) => [
                ($row->phase ?? '') === Phase::ADD_ON
                    ? ($row->internal_number ?? '')
                    : ($row->cip_number ?: ($row->internal_number ?? '')),
                trim((string) $row->applicant) !== '' ? trim((string) $row->applicant) : '-',
                Status::label((string) $row->status),
                $row->provider ?: '-',
                InvestmentType::display($row->investment_type, $row->investment_type_other) ?: '-',
                $row->officer ?: '-',
                self::day($row->submitted_at),
                self::day($row->decided_at),
            ])->all(),
            'rowHrefs' => $rows->map(function ($row) {
                $uid = trim((string) ($row->client_uid ?? ''));

                return $uid !== '' ? Pages::application($uid) : '';
            })->all(),
        ];
    }

    private static function grouped(Builder $base, string $column, string $heading, string $title): array
    {
        $rows = (clone $base)
            ->select(DB::raw($column.' as bucket'), DB::raw('count(distinct a.id) as total'))
            ->groupBy($column)
            ->orderByDesc(DB::raw('count(distinct a.id)'))
            ->get();

        return [
            'title' => $title,
            'columns' => [$heading, 'Applications'],
            'rows' => $rows->map(function ($row) use ($column) {
                $label = trim((string) $row->bucket);

                if ($column === 'a.investment_type') {
                    $label = InvestmentType::label($label) ?: '-';
                } elseif ($column === 'pe.relationship') {
                    $label = AddOn::relationshipLabel($label !== '' ? $label : null) ?: '-';
                } elseif ($label === '') {
                    $label = '-';
                }

                return [$label, self::number((int) $row->total)];
            })->all(),
        ];
    }

    private static function tally(Builder $query): int
    {
        // `select()` replaces columns so this cannot become `SELECT *, count(...)`.
        return (int) (clone $query)->select(DB::raw('count(distinct a.id) as aggregate'))->value('aggregate');
    }

    private static function metric(string $label, int $value, ?string $hint = null): array
    {
        return array_filter([
            'label' => $label,
            'value' => self::number($value),
            'raw' => $value,
            'hint' => $hint,
        ], fn ($v) => $v !== null);
    }

    private static function number(int $value): string
    {
        return number_format($value);
    }

    private static function day(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '-';
        }

        return Carbon::parse($value)->toDateString();
    }

    private static function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private static function normalizeNumber(string $value): string
    {
        return mb_strtolower(preg_replace('/\s+/u', '', $value) ?? '');
    }

    private static function numberMatchSql(string $column): string
    {
        return DB::connection()->getDriverName() === 'mysql'
            ? 'LOWER(REPLACE(COALESCE('.$column.", ''), ' ', '')) = ?"
            : 'LOWER(REPLACE(COALESCE('.$column.", ''), ' ', '')) = ?";
    }

    /** Applicant display name in SQL both sqlite/pgsql (`||`) and mysql understand. */
    private static function personNameSql(): string
    {
        return DB::connection()->getDriverName() === 'mysql'
            ? "trim(concat(coalesce(first_name, ''), ' ', coalesce(last_name, '')))"
            : "trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))";
    }
}
