<?php

namespace App\Support\Reports;

use App\Models\Report;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Turns a report request into real numbers.
 *
 * Everything here is measured from tables the portal already writes as a side
 * effect of being used — sign-ins land in `activity_logs`, opens and downloads
 * in `file_activities`, bytes in `files` — so a report is a read, never a
 * separate tracking pipeline that could drift from what happened.
 *
 * Queries go through the query builder rather than Eloquent on purpose. A
 * report counts history: a message that was later deleted was still sent, and
 * a file that was later binned was still uploaded, so the soft-delete scopes
 * must not silently subtract them. Where "still there now" *is* the question
 * (storage on hand), the `deleted_at` filter is written out explicitly.
 *
 * The output shape is deliberately generic — a metric strip plus one table —
 * so the Reporting page renders any report type without knowing what it means.
 */
final class ReportBuilder
{
    /** Rows in a report's breakdown table. Enough to act on, short enough to read. */
    private const TOP_N = 10;

    public static function build(Report $report): array
    {
        $from = $report->starts_on->copy()->startOfDay();
        $to = $report->ends_on->copy()->endOfDay();

        $body = match ($report->type) {
            Report::TYPE_USAGE => self::usage($from, $to),
            Report::TYPE_ACCESS => self::access($from, $to),
            Report::TYPE_MESSAGING => self::messaging($from, $to),
            Report::TYPE_STORAGE => self::storage($from, $to),
            default => ['metrics' => [], 'table' => null],
        };

        return [
            'generatedAt' => now()->toIso8601String(),
            'window' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
        ] + $body;
    }

    /** A one-line title for a report of this type over this window. */
    public static function name(string $type, string $rangeLabel): string
    {
        return match ($type) {
            Report::TYPE_USAGE => 'Usage report',
            Report::TYPE_ACCESS => 'Access report',
            Report::TYPE_MESSAGING => 'Messaging report',
            Report::TYPE_STORAGE => 'Storage report',
            default => 'Report',
        }.' — '.$rangeLabel;
    }

    /* ── report types ───────────────────────────────────────────────── */

    /**
     * Who used the account, and how much of it.
     *
     * Sign-ins come from the audit trail rather than `auth_events` because that
     * is the table the portal's own Activity views read; the two agree, and
     * using one keeps a report and the activity log from disagreeing.
     */
    private static function usage(Carbon $from, Carbon $to): array
    {
        $signIns = self::window(DB::table('activity_logs'), 'created_at', $from, $to)
            ->where('activity_type', 'security.login');

        $peopleSignedIn = (clone $signIns)->whereNotNull('actor_id')->distinct()->count('actor_id');

        $newAccounts = self::window(DB::table('users'), 'created_at', $from, $to)->count();

        $activeAccounts = DB::table('users')
            ->whereNull('deleted_at')
            ->where('status', 'approved')
            ->count();

        $uploads = self::window(DB::table('files'), 'created_at', $from, $to);
        $uploadBytes = (int) (clone $uploads)->sum('size');

        $emails = self::window(DB::table('email_deliveries'), 'created_at', $from, $to);

        $metrics = [
            self::metric('Sign-ins', $signIns->count(), $peopleSignedIn.' '.self::plural($peopleSignedIn, 'person', 'people')),
            self::metric('Active accounts', $activeAccounts, $newAccounts.' new in this period'),
            self::metric('Files uploaded', (clone $uploads)->count(), self::bytes($uploadBytes)),
            self::metric('Messages sent', self::window(DB::table('messages'), 'created_at', $from, $to)->count()),
            self::metric('Emails sent', (clone $emails)->whereNotIn('status', ['queued', 'failed', 'bounced', 'cancelled'])->count(),
                (clone $emails)->count().' attempted'),
            self::metric('Recorded activity', self::window(DB::table('activity_logs'), 'created_at', $from, $to)->count()),
        ];

        $rows = self::window(DB::table('activity_logs'), 'activity_logs.created_at', $from, $to)
            ->join('users', 'users.id', '=', 'activity_logs.actor_id')
            ->groupBy('users.id', 'users.name', 'users.account_type')
            ->orderByDesc(DB::raw('count(*)'))
            ->limit(self::TOP_N)
            ->get(['users.name', 'users.account_type', DB::raw('count(*) as total')]);

        return [
            'metrics' => $metrics,
            'table' => [
                'title' => 'Busiest accounts',
                'columns' => ['Account', 'Type', 'Actions'],
                'rows' => $rows->map(fn ($r) => [$r->name, $r->account_type, self::number((int) $r->total)])->all(),
            ],
        ];
    }

    /** What was opened, downloaded and shared. */
    private static function access(Carbon $from, Carbon $to): array
    {
        $activity = fn () => self::window(DB::table('file_activities'), 'created_at', $from, $to);

        $downloads = $activity()->whereIn('action', ['download'])->count();
        $views = $activity()->whereIn('action', ['preview', 'view', 'open'])->count();
        $uploads = $activity()->where('action', 'upload')->count();

        // A null actor on a file activity is somebody who followed a share
        // link without signing in — the only anonymous reader the portal has.
        $anonymous = $activity()->whereNull('user_id')->count();

        $shares = self::window(DB::table('shares'), 'created_at', $from, $to);

        $metrics = [
            self::metric('Files opened', $views),
            self::metric('Downloads', $downloads),
            self::metric('Uploads', $uploads),
            self::metric('Shares created', (clone $shares)->count(),
                (clone $shares)->where('kind', 'link')->count().' by link'),
            self::metric('People active', $activity()->whereNotNull('user_id')->distinct()->count('user_id'),
                $anonymous.' anonymous link '.self::plural($anonymous, 'visit', 'visits')),
            self::metric('Sign-ins', self::window(DB::table('activity_logs'), 'created_at', $from, $to)
                ->where('activity_type', 'security.login')->count()),
        ];

        $rows = self::window(DB::table('file_activities'), 'file_activities.created_at', $from, $to)
            ->where('file_activities.item_type', 'file')
            ->join('files', 'files.id', '=', 'file_activities.item_id')
            ->groupBy('files.id', 'files.name')
            ->orderByDesc(DB::raw('count(*)'))
            ->limit(self::TOP_N)
            ->get([
                'files.name',
                DB::raw('count(*) as total'),
                DB::raw("sum(case when file_activities.action = 'download' then 1 else 0 end) as downloads"),
            ]);

        return [
            'metrics' => $metrics,
            'table' => [
                'title' => 'Most active files',
                'columns' => ['File', 'Actions', 'Downloads'],
                'rows' => $rows->map(fn ($r) => [$r->name, self::number((int) $r->total), self::number((int) $r->downloads)])->all(),
            ],
        ];
    }

    /** Traffic through the portal's own messaging. */
    private static function messaging(Carbon $from, Carbon $to): array
    {
        $messages = fn () => self::window(DB::table('messages'), 'created_at', $from, $to);

        $attachments = self::window(DB::table('message_attachments'), 'created_at', $from, $to)
            ->whereNotNull('message_id');

        $metrics = [
            self::metric('Messages sent', $messages()->count()),
            self::metric('Conversations active', $messages()->distinct()->count('conversation_id')),
            self::metric('People messaging', $messages()->whereNotNull('user_id')->distinct()->count('user_id')),
            self::metric('Attachments', (clone $attachments)->count(), self::bytes((int) (clone $attachments)->sum('size'))),
            self::metric('Voice notes', $messages()->where('type', 'voice')->count()),
            self::metric('New conversations', self::window(DB::table('conversations'), 'created_at', $from, $to)->count()),
        ];

        $rows = self::window(DB::table('messages'), 'messages.created_at', $from, $to)
            ->join('users', 'users.id', '=', 'messages.user_id')
            ->groupBy('users.id', 'users.name')
            ->orderByDesc(DB::raw('count(*)'))
            ->limit(self::TOP_N)
            ->get([
                'users.name',
                DB::raw('count(*) as total'),
                DB::raw('count(distinct messages.conversation_id) as conversations'),
            ]);

        return [
            'metrics' => $metrics,
            'table' => [
                'title' => 'Most active senders',
                'columns' => ['Sender', 'Messages', 'Conversations'],
                'rows' => $rows->map(fn ($r) => [$r->name, self::number((int) $r->total), self::number((int) $r->conversations)])->all(),
            ],
        ];
    }

    /**
     * Bytes on hand, and how the window moved them.
     *
     * The totals are "right now" rather than as-of the window's end — storage
     * is a level, not a flow, and a report that claimed to know what the disk
     * looked like three weeks ago would be inventing it. What the window does
     * bound is the added/removed pair.
     */
    private static function storage(Carbon $from, Carbon $to): array
    {
        $live = DB::table('files')->whereNull('deleted_at');
        $added = self::window(DB::table('files'), 'created_at', $from, $to);
        $binned = self::window(DB::table('files'), 'deleted_at', $from, $to)->whereNotNull('deleted_at');

        $totalBytes = (int) (clone $live)->sum('size');
        $fileCount = (clone $live)->count();

        $metrics = [
            self::metric('Storage used', self::bytes($totalBytes), self::number($fileCount).' '.self::plural($fileCount, 'file', 'files'), $totalBytes),
            self::metric('Added in period', self::bytes((int) (clone $added)->sum('size')), self::number((clone $added)->count()).' uploaded'),
            self::metric('Moved to the bin', self::bytes((int) (clone $binned)->sum('size')), self::number((clone $binned)->count()).' '.self::plural((clone $binned)->count(), 'file', 'files')),
            self::metric('Folders', DB::table('folders')->whereNull('deleted_at')->count()),
            self::metric('Message attachments', self::bytes((int) DB::table('message_attachments')->whereNull('deleted_at')->sum('size'))),
            self::metric('Average file size', self::bytes($fileCount > 0 ? (int) round($totalBytes / $fileCount) : 0)),
        ];

        $rows = DB::table('files')
            ->whereNull('files.deleted_at')
            ->join('users', 'users.id', '=', 'files.owner_id')
            ->groupBy('users.id', 'users.name')
            ->orderByDesc(DB::raw('sum(files.size)'))
            ->limit(self::TOP_N)
            ->get([
                'users.name',
                DB::raw('count(*) as total'),
                DB::raw('sum(files.size) as bytes'),
            ]);

        return [
            'metrics' => $metrics,
            'table' => [
                'title' => 'Storage by owner',
                'columns' => ['Owner', 'Files', 'Size'],
                'rows' => $rows->map(fn ($r) => [$r->name, self::number((int) $r->total), self::bytes((int) $r->bytes)])->all(),
            ],
        ];
    }

    /* ── helpers ────────────────────────────────────────────────────── */

    private static function window(Builder $query, string $column, Carbon $from, Carbon $to): Builder
    {
        return $query->whereBetween($column, [$from, $to]);
    }

    /**
     * One metric tile. `raw` carries the number behind a formatted value so the
     * page can sort or chart it later without re-parsing "1.4 GB".
     */
    private static function metric(string $label, string|int $value, ?string $hint = null, ?int $raw = null): array
    {
        return array_filter([
            'label' => $label,
            'value' => is_int($value) ? self::number($value) : $value,
            'raw' => $raw ?? (is_int($value) ? $value : null),
            'hint' => $hint,
        ], fn ($v) => $v !== null);
    }

    private static function number(int $value): string
    {
        return number_format($value);
    }

    private static function plural(int $count, string $one, string $many): string
    {
        return $count === 1 ? $one : $many;
    }

    private static function bytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        $power = min((int) floor(log($bytes, 1024)), count($units) - 1);
        $value = $bytes / (1024 ** $power);

        return ($power === 0 ? (string) $bytes : number_format($value, $value >= 100 ? 0 : 1)).' '.$units[$power];
    }
}
