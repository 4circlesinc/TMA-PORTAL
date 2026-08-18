<?php

namespace App\Support\Reports;

use App\Models\CipPerson;
use App\Models\Report;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CIP application reports (§25).
 *
 * One builder, seven presets. The filters are the brief's list — status,
 * service provider, investment type, applicant, assigned officer, submission
 * date, decision date, date range — and the named examples are just those
 * filters already filled in. Numbers come from `cip_applications` itself,
 * including withdrawn rows, so a historical grant still counts after the
 * file left the live table.
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
    ];

    public const PRESET_LABELS = [
        'pending_review' => 'Applications Pending Review',
        'background_check' => 'Applications in Background Check',
        'delayed' => 'Delayed Applications',
        'granted' => 'Granted Applications',
        'denied' => 'Denied Applications',
        'by_provider' => 'Applications by Service Provider',
        'by_investment_type' => 'Applications by Investment Type',
    ];

    /** Rows kept on the stored table — enough for a sitting, not a dump of the legacy book. */
    private const LIST_CAP = 2000;

    /**
     * @return array{metrics: list<array<string, mixed>>, table: array{title: string, columns: list<string>, rows: list<list<string>>}}
     */
    public static function build(Report $report, Carbon $from, Carbon $to): array
    {
        $filters = is_array($report->filters) ? $report->filters : [];
        $base = self::filtered($filters, $report->range_key, $from, $to);

        $total = self::tally($base);
        $hint = $total === 1 ? 'application' : 'applications';

        $metrics = [
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
            default => self::listing($base, $total),
        };

        return [
            'metrics' => $metrics,
            'table' => $table,
        ];
    }

    public static function title(array $filters, string $rangeLabel): string
    {
        $preset = $filters['preset'] ?? null;
        $head = self::PRESET_LABELS[$preset] ?? 'CIP Applications';

        return $head.' — '.$rangeLabel;
    }

    /* ── the question ───────────────────────────────────────────────── */

    private static function filtered(array $filters, string $rangeKey, Carbon $from, Carbon $to): Builder
    {
        $applicants = DB::table('cip_people')
            ->where('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->select(
                'application_id',
                DB::raw("trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) as name"),
            );

        $query = DB::table('cip_applications as a')
            ->leftJoin('cip_providers as p', 'p.id', '=', 'a.provider_id')
            ->leftJoin('users as o', 'o.id', '=', 'a.assigned_officer_id')
            ->leftJoinSub($applicants, 'pe', 'pe.application_id', '=', 'a.id');

        $status = self::status($filters);

        if ($status !== null) {
            $query->where('a.status', $status);
        }

        if (! empty($filters['providerId'])) {
            $query->where('a.provider_id', (int) $filters['providerId']);
        }

        if (! empty($filters['investmentType'])) {
            $query->where('a.investment_type', $filters['investmentType']);
        }

        if (! empty($filters['officerId'])) {
            $query->where('a.assigned_officer_id', (int) $filters['officerId']);
        }

        $applicant = trim((string) ($filters['applicant'] ?? ''));

        if ($applicant !== '') {
            $like = '%'.self::escapeLike($applicant).'%';
            $query->where('pe.name', 'like', $like);
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
        if (! empty($filters['status']) && Status::isValid($filters['status'])) {
            return $filters['status'];
        }

        $preset = $filters['preset'] ?? null;

        return self::PRESETS[$preset] ?? null;
    }

    /* ── answers ────────────────────────────────────────────────────── */

    private static function listing(Builder $base, int $total): array
    {
        $rows = (clone $base)
            ->orderByDesc('a.id')
            ->limit(self::LIST_CAP)
            ->get([
                'a.internal_number',
                'a.cip_number',
                'pe.name as applicant',
                'a.status',
                'p.name as provider',
                'a.investment_type',
                'a.investment_type_other',
                'o.name as officer',
                'a.submitted_at',
                'a.decided_at',
            ]);

        $listed = $rows->count();
        $title = 'Applications';
        if ($listed < $total) {
            $title .= ' (first '.self::number($listed).' of '.self::number($total).')';
        }

        return [
            'title' => $title,
            'columns' => ['Number', 'Applicant', 'Status', 'Service provider', 'Investment type', 'Assigned officer', 'Submitted', 'Decision date'],
            'rows' => $rows->map(fn ($row) => [
                $row->cip_number ?: ($row->internal_number ?? ''),
                trim((string) $row->applicant) !== '' ? trim((string) $row->applicant) : '—',
                Status::label((string) $row->status),
                $row->provider ?: '—',
                InvestmentType::display($row->investment_type, $row->investment_type_other) ?: '—',
                $row->officer ?: '—',
                self::day($row->submitted_at),
                self::day($row->decided_at),
            ])->all(),
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
                    $label = InvestmentType::label($label) ?: '—';
                } elseif ($label === '') {
                    $label = '—';
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
            return '—';
        }

        return Carbon::parse($value)->toDateString();
    }

    private static function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
