<?php

namespace App\Http\Controllers;

use App\Models\Report;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use App\Support\Reports\CipReport;
use App\Support\Reports\ReportBuilder;
use App\Support\Reports\ReportRunner;
use App\Support\UserTime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The Reporting page, a main sidebar page for administrators.
 *
 * The page offered "Create Report" and then filed a name and a date into
 * localStorage, no numbers, nothing to open, gone with the browser cache.
 * A report created here is computed on the spot from the portal's own tables
 * (see {@see ReportBuilder}) and stored with its answer, so what it said in
 * July still says the same thing in September.
 *
 * Recurring reports are the same row with a `frequency`; `reports:run`
 * recomputes them on the schedule and keeps the window rolling.
 */
class ReportsController extends Controller
{
    /** How many one-off reports the page lists. Older ones stay readable by id. */
    private const RECENT_LIMIT = 50;

    public function index(Request $request): JsonResponse
    {
        $this->authorizeReporting($request);

        $reports = Report::with('creator')->orderByDesc('created_at')->get();

        $types = [
            ['value' => Report::TYPE_USAGE, 'label' => 'Usage'],
            ['value' => Report::TYPE_ACCESS, 'label' => 'Access'],
            ['value' => Report::TYPE_MESSAGING, 'label' => 'Messaging'],
            ['value' => Report::TYPE_STORAGE, 'label' => 'Storage'],
        ];

        if (CipAccess::enabled()) {
            $types[] = ['value' => Report::TYPE_CIP, 'label' => 'CIP Applications'];
        }

        return response()->json([
            'recent' => $reports->whereNull('frequency')->take(self::RECENT_LIMIT)->map->toRecord()->values(),
            'recurring' => $reports->whereNotNull('frequency')->map->toRecord()->values(),
            'types' => $types,
            'ranges' => [
                ['value' => 'last_7', 'label' => 'Last 7 days'],
                ['value' => 'last_30', 'label' => 'Last 30 days'],
                ['value' => 'last_90', 'label' => 'Last 90 days'],
                ['value' => 'custom', 'label' => 'Custom'],
                ['value' => 'all', 'label' => 'All dates'],
            ],
            'frequencies' => [
                ['value' => 'weekly', 'label' => 'Every week'],
                ['value' => 'monthly', 'label' => 'Every month'],
            ],
            'cip' => CipAccess::enabled() ? $this->cipOptions() : null,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeReporting($request);

        $data = $request->validate([
            'type' => ['required', Rule::in(Report::TYPES)],
            'range' => ['required', Rule::in(array_keys(Report::RANGES))],
            // Only read when range is `custom`; validated here either way so a
            // malformed date can never reach the window maths.
            'startsOn' => ['nullable', 'date'],
            'endsOn' => ['nullable', 'date', 'after_or_equal:startsOn'],
            'recurring' => ['sometimes', 'boolean'],
            'frequency' => ['nullable', Rule::in(Report::FREQUENCIES)],
            'name' => ['nullable', 'string', 'max:120'],
            'filters' => ['nullable', 'array'],
            'filters.preset' => ['nullable', 'string', Rule::in(array_keys(CipReport::PRESETS))],
            'filters.status' => ['nullable', 'string', Rule::in(Status::ALL)],
            'filters.providerId' => ['nullable', 'integer'],
            'filters.investmentType' => ['nullable', 'string', Rule::in(array_keys(InvestmentType::ALL))],
            'filters.applicant' => ['nullable', 'string', 'max:191'],
            'filters.officerId' => ['nullable', 'integer'],
            'filters.submittedFrom' => ['nullable', 'date'],
            'filters.submittedTo' => ['nullable', 'date', 'after_or_equal:filters.submittedFrom'],
            'filters.decidedFrom' => ['nullable', 'date'],
            'filters.decidedTo' => ['nullable', 'date', 'after_or_equal:filters.decidedFrom'],
        ]);

        if ($data['type'] === Report::TYPE_CIP) {
            abort_unless(CipAccess::enabled(), 422, 'CIP reporting is not available.');
            abort_unless(Role::can($request->user(), 'cip.report'), 403);
        }

        $filters = $data['type'] === Report::TYPE_CIP ? $this->cipFilters($data['filters'] ?? []) : null;

        [$startsOn, $endsOn] = $this->window($data, $request->user());

        $recurring = (bool) ($data['recurring'] ?? false);
        // "Recurring" with no cadence chosen means weekly rather than a row
        // that sits in the recurring tab and never runs.
        $frequency = $recurring ? ($data['frequency'] ?? 'weekly') : null;

        $report = new Report([
            'type' => $data['type'],
            'filters' => $filters,
            'range_key' => $data['range'],
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'frequency' => $frequency,
            'status' => Report::STATUS_PENDING,
            'created_by' => $request->user()->id,
        ]);

        $report->name = ($data['name'] ?? null) ?: ReportBuilder::name($data['type'], $report->rangeLabel(), $filters ?? []);
        $report->save();

        ReportRunner::run($report);

        return response()->json(['report' => $report->fresh('creator')->toRecord(withData: true)], 201);
    }

    public function show(Request $request, string $uid): JsonResponse
    {
        $this->authorizeReporting($request);

        return response()->json(['report' => $this->find($uid)->toRecord(withData: true)]);
    }

    /** Recompute a report now, the recurring tab's "Run now", and the retry after a failure. */
    public function run(Request $request, string $uid): JsonResponse
    {
        $this->authorizeReporting($request);

        $report = $this->find($uid);

        ReportRunner::run(ReportRunner::rollWindow($report));

        return response()->json(['report' => $report->fresh('creator')->toRecord(withData: true)]);
    }

    public function destroy(Request $request, string $uid): JsonResponse
    {
        $this->authorizeReporting($request);

        $this->find($uid)->delete();

        return response()->json(['status' => 'ok']);
    }

    /** The report's breakdown table as a CSV the finance team can open. */
    public function export(Request $request, string $uid): StreamedResponse
    {
        $this->authorizeReporting($request);

        $report = $this->find($uid);
        $data = $report->data ?: [];
        $user = $request->user();

        $filename = str($report->name)->slug()->value().'.csv';

        return response()->streamDownload(function () use ($report, $data, $user) {
            $out = fopen('php://output', 'w');

            // escape: '' is RFC 4180 quoting. PHP's default backslash escape
            // mangles any value containing one, and relying on it is deprecated.
            $line = fn (array $cells) => fputcsv($out, $cells, ',', '"', '');

            $line([$report->name]);
            $period = ($data['window']['from'] ?? null) && ($data['window']['to'] ?? null)
                ? $data['window']['from'].' to '.$data['window']['to']
                : 'All dates';
            $line(['Period', $period]);
            $line(['Generated', UserTime::format($report->generated_at, $user, 'j M Y, H:i')]);
            $line([]);

            $line(['Measure', 'Value', 'Detail']);
            foreach ($data['metrics'] ?? [] as $metric) {
                $line([$metric['label'] ?? '', $metric['value'] ?? '', $metric['hint'] ?? '']);
            }

            if (! empty($data['table']['rows'])) {
                $line([]);
                $line([$data['table']['title'] ?? 'Breakdown']);
                $line($data['table']['columns'] ?? []);
                foreach ($data['table']['rows'] as $row) {
                    $line($row);
                }
            }

            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv']);
    }

    /* ── internals ──────────────────────────────────────────────────── */

    /**
     * The dates a report covers.
     *
     * The preset ranges are inclusive of today, so "Last 7 days" is today plus
     * the six before it, the reader's own days, not UTC's, or a report run at
     * 9pm in Sydney would be labelled with yesterday's date.
     */
    private function window(array $data, $user): array
    {
        $today = Carbon::now(UserTime::zone($user));

        if ($data['range'] === 'all') {
            return ['1970-01-01', $today->toDateString()];
        }

        if ($data['range'] === 'custom') {
            $starts = isset($data['startsOn']) ? Carbon::parse($data['startsOn']) : $today->copy()->subDays(29);
            $ends = isset($data['endsOn']) ? Carbon::parse($data['endsOn']) : $today;

            return [$starts->toDateString(), $ends->toDateString()];
        }

        $days = Report::RANGES[$data['range']];

        return [$today->copy()->subDays($days - 1)->toDateString(), $today->toDateString()];
    }

    private function find(string $uid): Report
    {
        return Report::with('creator')->where('uid', $uid)->firstOrFail();
    }

    /**
     * Dropdowns the CIP create dialog needs, so a filter is a pick from the
     * live caseload rather than a string somebody has to remember.
     *
     * @return array<string, mixed>
     */
    private function cipOptions(): array
    {
        $providers = DB::table('cip_providers')
            ->orderBy('name')
            ->get(['id', 'name', 'code'])
            ->map(fn ($row) => [
                'value' => (int) $row->id,
                'label' => $row->name.($row->code ? ' ('.$row->code.')' : ''),
            ])
            ->all();

        $officerIds = DB::table('cip_applications')
            ->whereNotNull('assigned_officer_id')
            ->distinct()
            ->pluck('assigned_officer_id')
            ->merge(DB::table('cip_application_assignments')->distinct()->pluck('user_id'))
            ->unique()
            ->filter()
            ->all();

        $officers = $officerIds === []
            ? []
            : DB::table('users')
                ->whereIn('id', $officerIds)
                ->orderBy('name')
                ->get(['id', 'name'])
                ->map(fn ($row) => ['value' => (int) $row->id, 'label' => $row->name])
                ->all();

        return [
            'presets' => collect(CipReport::PRESET_LABELS)
                ->map(fn (string $label, string $value) => ['value' => $value, 'label' => $label])
                ->values()
                ->all(),
            'statuses' => collect(Status::listed())
                ->map(fn (string $status) => ['value' => $status, 'label' => Status::label($status)])
                ->all(),
            'providers' => $providers,
            'investmentTypes' => InvestmentType::options(),
            'officers' => $officers,
        ];
    }

    /**
     * Drop empty CIP filters so a stored report does not carry noise that
     * later looks like a constraint.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>|null
     */
    private function cipFilters(array $filters): ?array
    {
        $clean = [];

        foreach ([
            'preset', 'status', 'providerId', 'investmentType', 'applicant',
            'officerId', 'submittedFrom', 'submittedTo', 'decidedFrom', 'decidedTo',
        ] as $key) {
            $value = $filters[$key] ?? null;

            if (is_string($value)) {
                $value = trim($value);
            }

            if ($value === null || $value === '') {
                continue;
            }

            if (in_array($key, ['providerId', 'officerId'], true)) {
                $value = (int) $value;
            }

            $clean[$key] = $value;
        }

        return $clean === [] ? null : $clean;
    }

    private function authorizeReporting(Request $request): void
    {
        abort_unless(Role::can($request->user(), 'settings.reporting'), 403);
    }
}
