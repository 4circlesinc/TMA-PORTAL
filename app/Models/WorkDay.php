<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One user's work plan for a single calendar date.
 *
 * Weekdays default to 08:00–17:00 / in_office when no row exists; weekends
 * default to not_working. Explicit rows always win.
 */
class WorkDay extends Model
{
    public const STATUSES = [
        'in_office',
        'remote',
        'out_of_office',
        'on_leave',
        'sick_leave',
        'personal_leave',
        'field_work',
        'travelling',
        'flexible',
        'not_working',
    ];

    public const LABELS = [
        'in_office' => 'In office',
        'remote' => 'Working remotely',
        'out_of_office' => 'Out of office',
        'on_leave' => 'On leave',
        'sick_leave' => 'Sick leave',
        'personal_leave' => 'Personal leave',
        'field_work' => 'Field work',
        'travelling' => 'Travelling',
        'flexible' => 'Flexible',
        'not_working' => 'Not working',
    ];

    protected $fillable = [
        'user_id', 'work_date', 'status', 'starts_at', 'ends_at',
        'location', 'note', 'visibility',
    ];

    protected function casts(): array
    {
        return [
            'work_date' => 'date',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function labelFor(string $status): string
    {
        return self::LABELS[$status] ?? 'Work plan';
    }

    /**
     * Resolved plan for a date — stored row or weekday/weekend default.
     *
     * @return array<string, mixed>
     */
    public static function resolveFor(User $user, CarbonImmutable|string $date): array
    {
        $day = CarbonImmutable::parse($date)->startOfDay();
        $row = static::query()
            ->where('user_id', $user->id)
            ->whereDate('work_date', $day->toDateString())
            ->first();

        if ($row) {
            return $row->toRecord();
        }

        $isWeekend = $day->isWeekend();

        return [
            'id' => null,
            'date' => $day->toDateString(),
            'status' => $isWeekend ? 'not_working' : 'in_office',
            'statusLabel' => self::labelFor($isWeekend ? 'not_working' : 'in_office'),
            'startsAt' => $isWeekend ? null : '08:00',
            'endsAt' => $isWeekend ? null : '17:00',
            'location' => $isWeekend ? null : 'Office',
            'note' => null,
            'visibility' => 'colleagues',
            'isDefault' => true,
            'userId' => $user->id,
        ];
    }

    /** @return array<string, mixed> */
    public function toRecord(): array
    {
        $starts = $this->starts_at;
        $ends = $this->ends_at;
        if ($starts instanceof \DateTimeInterface) {
            $starts = CarbonImmutable::instance($starts)->format('H:i');
        }
        if ($ends instanceof \DateTimeInterface) {
            $ends = CarbonImmutable::instance($ends)->format('H:i');
        }
        // TIME columns may come back as plain "H:i:s" strings.
        if (is_string($starts) && strlen($starts) >= 5) {
            $starts = substr($starts, 0, 5);
        }
        if (is_string($ends) && strlen($ends) >= 5) {
            $ends = substr($ends, 0, 5);
        }

        return [
            'id' => $this->id,
            'date' => $this->work_date?->toDateString(),
            'status' => $this->status,
            'statusLabel' => self::labelFor($this->status),
            'startsAt' => $starts,
            'endsAt' => $ends,
            'location' => $this->location,
            'note' => $this->note,
            'visibility' => $this->visibility,
            'isDefault' => false,
            'userId' => $this->user_id,
        ];
    }

    /**
     * Public-facing status for directories (no private notes).
     *
     * @return array<string, mixed>|null
     */
    public static function publicStatusFor(User $user, ?CarbonImmutable $at = null): ?array
    {
        $at = $at ?? CarbonImmutable::now();

        return self::publicFromPlan(self::resolveFor($user, $at), $at);
    }

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, mixed>|null
     */
    public static function publicFromPlan(array $plan, ?CarbonImmutable $at = null): ?array
    {
        $at = $at ?? CarbonImmutable::now();
        if (($plan['visibility'] ?? 'colleagues') === 'private' && ! ($plan['isDefault'] ?? false)) {
            return null;
        }
        if (($plan['status'] ?? '') === 'not_working' && ($plan['isDefault'] ?? false) && $at->isWeekend()) {
            return null;
        }

        $label = $plan['statusLabel'] ?? self::labelFor((string) ($plan['status'] ?? ''));
        if (($plan['status'] ?? '') === 'out_of_office' && ! empty($plan['endsAt'])) {
            try {
                $end = CarbonImmutable::parse($at->toDateString().' '.$plan['endsAt']);
                if ($end->greaterThan($at)) {
                    $label .= ' until '.$end->format('g:i A');
                }
            } catch (\Throwable) {
                // keep plain label
            }
        }

        return [
            'status' => $plan['status'],
            'label' => $label,
            'startsAt' => $plan['startsAt'] ?? null,
            'endsAt' => $plan['endsAt'] ?? null,
            'location' => $plan['location'] ?? null,
        ];
    }

    /**
     * Batch public statuses for a set of users (one query for stored rows).
     *
     * @param  iterable<int, User>  $users
     * @return array<int, array<string, mixed>|null> keyed by user id
     */
    public static function publicStatusesForUsers(iterable $users, ?CarbonImmutable $at = null): array
    {
        $at = $at ?? CarbonImmutable::now();
        $userList = collect($users)->filter()->values();
        $ids = $userList->pluck('id')->all();
        if ($ids === []) {
            return [];
        }

        $stored = static::query()
            ->whereIn('user_id', $ids)
            ->whereDate('work_date', $at->toDateString())
            ->get()
            ->keyBy('user_id');

        $out = [];
        $isWeekend = $at->isWeekend();
        foreach ($userList as $user) {
            if ($stored->has($user->id)) {
                $plan = $stored[$user->id]->toRecord();
            } else {
                $plan = [
                    'id' => null,
                    'date' => $at->toDateString(),
                    'status' => $isWeekend ? 'not_working' : 'in_office',
                    'statusLabel' => self::labelFor($isWeekend ? 'not_working' : 'in_office'),
                    'startsAt' => $isWeekend ? null : '08:00',
                    'endsAt' => $isWeekend ? null : '17:00',
                    'location' => $isWeekend ? null : 'Office',
                    'note' => null,
                    'visibility' => 'colleagues',
                    'isDefault' => true,
                    'userId' => $user->id,
                ];
            }
            $out[(int) $user->id] = self::publicFromPlan($plan, $at);
        }

        return $out;
    }
}
