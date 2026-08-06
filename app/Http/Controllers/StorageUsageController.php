<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Settings → Storage → Usage: what the account is actually storing.
 *
 * The page used to read "2.1 GB of 1 TB used" no matter what was on disk. Every
 * number here is measured from the tables that own the bytes, and the bytes
 * live in more places than the File Library: previous versions of a file, the
 * attachments on messages and Feed posts, and anything soft-deleted, which
 * still occupies storage until it is purged. Counting only `files` would tell
 * an administrator the account is smaller than it is, which is the one mistake
 * a usage page must not make.
 *
 * The limit is a licence figure, not a measurement — nothing on this server can
 * observe what the plan allows, so it comes from config (see config/portal.php)
 * and the page says where it came from rather than implying it was metered.
 */
class StorageUsageController extends Controller
{
    /** Rows in the "by owner" and "largest files" tables. */
    private const TOP_N = 10;

    /** How far back the growth line looks. */
    private const GROWTH_DAYS = 30;

    public function index(Request $request): JsonResponse
    {
        abort_unless(Role::can($request->user(), 'settings.storage'), 403);

        $categories = $this->categories();
        $used = array_sum(array_column($categories, 'bytes'));

        return response()->json([
            'generatedAt' => now()->toIso8601String(),
            'usedBytes' => $used,
            'limit' => $this->limit(),
            'categories' => $categories,
            'byLocation' => $this->byLocation(),
            'byAccountType' => $this->byAccountType(),
            'topOwners' => $this->topOwners(),
            'largestFiles' => $this->largestFiles(),
            'growth' => $this->growth(),
        ]);
    }

    /* ── what is using the space ────────────────────────────────────── */

    /**
     * Every place the portal keeps bytes, as one comparable list.
     *
     * Order is deliberate: the two an administrator can act on — old versions
     * and the recycle bin — sit next to the files they belong to.
     *
     * @return list<array{key: string, label: string, bytes: int, count: int, hint?: string}>
     */
    private function categories(): array
    {
        $liveFiles = DB::table('files')->whereNull('deleted_at');

        // Only versions that are no longer current are *extra* bytes; the
        // current one is the file itself and is already counted above.
        $oldVersions = DB::table('file_versions')->where('is_current', false);

        $messages = DB::table('message_attachments')->whereNull('deleted_at');
        $feed = DB::table('feed_attachments')->whereNull('deleted_at');

        $binned = [
            DB::table('files')->whereNotNull('deleted_at'),
            DB::table('message_attachments')->whereNotNull('deleted_at'),
            DB::table('feed_attachments')->whereNotNull('deleted_at'),
        ];

        $binBytes = 0;
        $binCount = 0;
        foreach ($binned as $query) {
            $binBytes += (int) (clone $query)->sum('size');
            $binCount += (clone $query)->count();
        }

        $unfinished = $this->unfinishedUploads();

        return [
            [
                'key' => 'files',
                'label' => 'Files',
                'bytes' => (int) (clone $liveFiles)->sum('size'),
                'count' => (clone $liveFiles)->count(),
                'hint' => 'Everything in the File Library',
            ],
            [
                'key' => 'versions',
                'label' => 'Previous versions',
                'bytes' => (int) (clone $oldVersions)->sum('size'),
                'count' => (clone $oldVersions)->count(),
                'hint' => 'Earlier revisions kept by version history',
            ],
            [
                'key' => 'messages',
                'label' => 'Message attachments',
                'bytes' => (int) (clone $messages)->sum('size'),
                'count' => (clone $messages)->count(),
            ],
            [
                'key' => 'feed',
                'label' => 'Feed attachments',
                'bytes' => (int) (clone $feed)->sum('size'),
                'count' => (clone $feed)->count(),
            ],
            [
                'key' => 'bin',
                'label' => 'Deleted, not yet purged',
                'bytes' => $binBytes,
                'count' => $binCount,
                'hint' => 'Still stored until the recycle bin is emptied',
            ],
            [
                'key' => 'uploads',
                'label' => 'Unfinished uploads',
                'bytes' => $unfinished['bytes'],
                'count' => $unfinished['count'],
                'hint' => 'Chunks of uploads that never completed',
            ],
        ];
    }

    /**
     * Bytes already written by uploads that stopped part-way.
     *
     * An upload session holds its chunks on disk until it completes or is
     * cleaned up, so what is on disk is the chunks received, not the file's
     * declared size — a 2 GB upload abandoned after one chunk is not 2 GB.
     *
     * @return array{bytes: int, count: int}
     */
    private function unfinishedUploads(): array
    {
        $rows = DB::table('upload_sessions')
            ->whereNotIn('status', ['completed', 'cancelled', 'failed'])
            ->get(['size', 'chunk_size', 'received_count']);

        $bytes = $rows->sum(fn ($row) => min(
            (int) $row->size,
            (int) $row->chunk_size * (int) $row->received_count
        ));

        return ['bytes' => (int) $bytes, 'count' => $rows->count()];
    }

    /* ── where it lives ─────────────────────────────────────────────── */

    /**
     * Bytes per storage disk, summed across every table that records one.
     *
     * Each row carries the disk it was written to (see the files/attachment
     * migrations) precisely so content survives a disk switch, which means a
     * mature account legitimately has bytes in both places at once.
     *
     * @return list<array{key: string, label: string, bytes: int}>
     */
    private function byLocation(): array
    {
        $totals = [];

        $sources = [
            [DB::table('files')->whereNull('deleted_at'), 'disk'],
            [DB::table('file_versions')->where('is_current', false), 'disk'],
            [DB::table('message_attachments')->whereNull('deleted_at'), 'disk'],
            [DB::table('feed_attachments')->whereNull('deleted_at'), 'disk'],
        ];

        foreach ($sources as [$query, $column]) {
            foreach ($query->groupBy($column)->get([$column, DB::raw('sum(size) as bytes')]) as $row) {
                $disk = (string) ($row->{$column} ?: 'local');
                $totals[$disk] = ($totals[$disk] ?? 0) + (int) $row->bytes;
            }
        }

        arsort($totals);

        return array_values(array_map(fn ($disk, $bytes) => [
            'key' => $disk,
            'label' => $this->diskLabel($disk),
            'bytes' => $bytes,
        ], array_keys($totals), $totals));
    }

    private function diskLabel(string $disk): string
    {
        $driver = config("filesystems.disks.$disk.driver");

        return match (true) {
            $disk === 's3' || $driver === 's3' => 'Cloud object storage',
            $driver === 'local' => 'This server',
            default => $disk,
        };
    }

    /* ── who is using it ────────────────────────────────────────────── */

    /**
     * Staff vs clients. Files are attributed to their owner, so a file a member
     * of staff uploaded into a client's folder counts against staff — the
     * question this answers is who is putting bytes in, not where they landed.
     *
     * @return list<array{label: string, bytes: int, count: int}>
     */
    private function byAccountType(): array
    {
        $rows = DB::table('files')
            ->whereNull('files.deleted_at')
            ->join('users', 'users.id', '=', 'files.owner_id')
            ->groupBy('users.account_type')
            ->orderByDesc(DB::raw('sum(files.size)'))
            ->get(['users.account_type', DB::raw('sum(files.size) as bytes'), DB::raw('count(*) as total')]);

        return $rows->map(fn ($row) => [
            'label' => (string) $row->account_type,
            'bytes' => (int) $row->bytes,
            'count' => (int) $row->total,
        ])->all();
    }

    /** @return list<array{name: string, type: string, bytes: int, count: int}> */
    private function topOwners(): array
    {
        $rows = DB::table('files')
            ->whereNull('files.deleted_at')
            ->join('users', 'users.id', '=', 'files.owner_id')
            ->groupBy('users.id', 'users.name', 'users.account_type')
            ->orderByDesc(DB::raw('sum(files.size)'))
            ->limit(self::TOP_N)
            ->get([
                'users.name',
                'users.account_type',
                DB::raw('sum(files.size) as bytes'),
                DB::raw('count(*) as total'),
            ]);

        return $rows->map(fn ($row) => [
            'name' => (string) $row->name,
            'type' => (string) $row->account_type,
            'bytes' => (int) $row->bytes,
            'count' => (int) $row->total,
        ])->all();
    }

    /** @return list<array{name: string, folder: ?string, owner: ?string, bytes: int, uploadedAt: ?string}> */
    private function largestFiles(): array
    {
        $rows = DB::table('files')
            ->whereNull('files.deleted_at')
            ->leftJoin('folders', 'folders.id', '=', 'files.folder_id')
            ->leftJoin('users', 'users.id', '=', 'files.owner_id')
            ->orderByDesc('files.size')
            ->limit(self::TOP_N)
            ->get([
                'files.name',
                'files.size',
                'files.created_at',
                'folders.name as folder_name',
                'users.name as owner_name',
            ]);

        return $rows->map(fn ($row) => [
            'name' => (string) $row->name,
            'folder' => $row->folder_name ? (string) $row->folder_name : null,
            'owner' => $row->owner_name ? (string) $row->owner_name : null,
            'bytes' => (int) $row->size,
            'uploadedAt' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : null,
        ])->all();
    }

    /* ── how it is moving ───────────────────────────────────────────── */

    /**
     * The last month, in and out. "Out" is what was moved to the bin in the
     * window, which is space that becomes free only once it is purged — so the
     * two figures are not a net change and the page does not present them as one.
     *
     * @return array{days: int, addedBytes: int, addedFiles: int, binnedBytes: int, binnedFiles: int}
     */
    private function growth(): array
    {
        $since = now()->subDays(self::GROWTH_DAYS);

        $added = DB::table('files')->where('created_at', '>=', $since);
        $binned = DB::table('files')->whereNotNull('deleted_at')->where('deleted_at', '>=', $since);

        return [
            'days' => self::GROWTH_DAYS,
            'addedBytes' => (int) (clone $added)->sum('size'),
            'addedFiles' => (clone $added)->count(),
            'binnedBytes' => (int) (clone $binned)->sum('size'),
            'binnedFiles' => (clone $binned)->count(),
        ];
    }

    /* ── what the plan allows ───────────────────────────────────────── */

    /**
     * The allowance to measure usage against.
     *
     * Storage is sold per licence, so the default is a per-licence figure times
     * the staff accounts in use; an account on a flat allowance sets
     * PORTAL_STORAGE_LIMIT_BYTES instead. Either way `source` travels with it so
     * the page can say what the bar is measuring against — an invented ceiling
     * presented as fact is worse than no bar at all.
     *
     * @return array{bytes: ?int, source: string, licences: int, perLicenceBytes: int}
     */
    private function limit(): array
    {
        $configured = (int) config('portal.storage.limit_bytes', 0);
        $perLicence = (int) config('portal.storage.per_licence_bytes', 0);

        $licences = DB::table('users')
            ->whereNull('deleted_at')
            ->where('status', 'approved')
            ->whereIn('account_type', Role::STAFF)
            ->count();

        if ($configured > 0) {
            return [
                'bytes' => $configured,
                'source' => 'configured',
                'licences' => $licences,
                'perLicenceBytes' => $perLicence,
            ];
        }

        return [
            'bytes' => $perLicence > 0 && $licences > 0 ? $perLicence * $licences : null,
            'source' => 'licences',
            'licences' => $licences,
            'perLicenceBytes' => $perLicence,
        ];
    }
}
