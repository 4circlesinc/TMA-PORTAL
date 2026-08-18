<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * One account report: what to measure, over which window, and the answer.
 *
 * See {@see App\Support\Reports\ReportBuilder} for where `data` comes from.
 */
#[Fillable([
    'uid', 'name', 'type', 'filters', 'range_key', 'starts_on', 'ends_on', 'frequency',
    'next_run_at', 'generated_at', 'status', 'data', 'error', 'created_by',
])]
class Report extends Model
{
    public const TYPE_USAGE = 'usage';

    public const TYPE_ACCESS = 'access';

    public const TYPE_MESSAGING = 'messaging';

    public const TYPE_STORAGE = 'storage';

    public const TYPE_CIP = 'cip';

    public const TYPES = [
        self::TYPE_USAGE, self::TYPE_ACCESS, self::TYPE_MESSAGING, self::TYPE_STORAGE, self::TYPE_CIP,
    ];

    /** Range key => how many days back the window starts. `custom` and `all` have none. */
    public const RANGES = [
        'last_7' => 7,
        'last_30' => 30,
        'last_90' => 90,
        'custom' => null,
        'all' => null,
    ];

    public const FREQUENCIES = ['weekly', 'monthly'];

    public const STATUS_PENDING = 'pending';

    public const STATUS_READY = 'ready';

    public const STATUS_FAILED = 'failed';

    protected function casts(): array
    {
        return [
            'starts_on' => 'date',
            'ends_on' => 'date',
            'next_run_at' => 'datetime',
            'generated_at' => 'datetime',
            'data' => 'array',
            'filters' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Report $report) {
            $report->uid ??= (string) Str::ulid();
        });
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isRecurring(): bool
    {
        return $this->frequency !== null;
    }

    /** Human label for the window, e.g. "Last 30 days" or "1 Jul – 14 Jul 2026". */
    public function rangeLabel(): string
    {
        return match ($this->range_key) {
            'last_7' => 'Last 7 days',
            'last_30' => 'Last 30 days',
            'last_90' => 'Last 90 days',
            'all' => 'All dates',
            default => $this->starts_on->format('j M').' – '.$this->ends_on->format('j M Y'),
        };
    }

    /**
     * When a recurring report should next be recomputed.
     *
     * Measured from the run that just happened rather than from `now()`, so a
     * scheduler that catches up after being down doesn't drift the whole
     * series forward by however long it was off.
     */
    public function scheduleAfter(Carbon $ranAt): ?Carbon
    {
        return match ($this->frequency) {
            'weekly' => $ranAt->copy()->addWeek(),
            'monthly' => $ranAt->copy()->addMonthNoOverflow(),
            default => null,
        };
    }

    /** The shape the Reporting page renders in its two tables. */
    public function toRecord(bool $withData = false): array
    {
        return array_filter([
            'id' => $this->uid,
            'name' => $this->name,
            'type' => $this->type,
            'range' => $this->rangeLabel(),
            'startsOn' => $this->starts_on?->toDateString(),
            'endsOn' => $this->ends_on?->toDateString(),
            'frequency' => $this->frequency,
            'status' => $this->status,
            'error' => $this->error,
            'createdBy' => $this->creator?->name,
            'created' => $this->created_at?->toIso8601String(),
            'generatedAt' => $this->generated_at?->toIso8601String(),
            'nextRunAt' => $this->next_run_at?->toIso8601String(),
            'filters' => $this->filters ?: null,
            'data' => $withData ? ($this->data ?: null) : null,
        ], fn ($v) => $v !== null);
    }
}
