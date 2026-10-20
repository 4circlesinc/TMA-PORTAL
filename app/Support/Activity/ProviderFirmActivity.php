<?php

namespace App\Support\Activity;

use App\Models\ActivityLog;
use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\CompanyMember;
use App\Models\FileActivity;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyAccess;
use App\Support\Notifications\NotificationPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * What a Service Provider admin may read on Overview → Activity.
 *
 * They do not hold activity.viewAll, and they must not: that flag is the
 * whole firm's trail, including other providers and staff addresses. Their
 * trail is the people at their own firm, the clients those people filed,
 * and the files in that firm's folders. A regular provider contact stays
 * on the privacy default — only the rows they performed themselves.
 */
final class ProviderFirmActivity
{
    /** Reads of a file. They drown the edits and uploads this feed is for. */
    private const QUIET_FILE_ACTIONS = ['preview', 'download', 'print', 'zip'];

    public static function applies(User $user): bool
    {
        return Role::isServiceProviderAdmin($user) && ! Role::can($user, 'activity.viewAll');
    }

    /**
     * Audit rows this admin may see: their firm's people, and anything
     * recorded against a client that firm filed.
     */
    public static function constrainAudit(Builder $query, User $viewer): Builder
    {
        $members = self::memberUserIds($viewer);
        $clients = self::clientIds($viewer);

        return $query->where(function (Builder $inner) use ($members, $clients) {
            $inner->whereIn('actor_id', $members !== [] ? $members : [-1]);
            if ($clients !== []) {
                $inner->orWhereIn('client_id', $clients);
            }
        });
    }

    /**
     * @return list<int>
     */
    public static function memberUserIds(User $user): array
    {
        $companyIds = CompanyAccess::companiesFor($user);
        $ids = $companyIds === []
            ? []
            : CompanyMember::active()
                ->whereIn('company_id', $companyIds)
                ->pluck('user_id')
                ->all();

        $ids[] = $user->id;

        return array_values(array_unique(array_map('intval', $ids)));
    }

    /**
     * @return list<int>
     */
    public static function clientIds(User $user): array
    {
        $companyIds = CompanyAccess::companiesFor($user);
        if ($companyIds === []) {
            return [];
        }

        $owned = Client::query()->whereIn('company_id', $companyIds)->pluck('id');
        $providerIds = CipProvider::query()->whereIn('company_id', $companyIds)->pluck('id');
        $filed = $providerIds->isEmpty()
            ? collect()
            : CipApplication::query()
                ->whereIn('provider_id', $providerIds)
                ->whereNotNull('client_id')
                ->pluck('client_id');

        return $owned->merge($filed)->unique()->map(fn ($id) => (int) $id)->values()->all();
    }

    public static function wantsFiles(Request $request): bool
    {
        $module = (string) $request->query('module', '');
        if ($module !== '' && $module !== 'files') {
            return false;
        }

        $status = (string) $request->query('status', '');
        if ($status !== '' && $status !== ActivityLog::STATUS_SUCCESS) {
            return false;
        }

        return ! $request->boolean('system');
    }

    /** File edits and uploads on this firm's folders, and by its people. */
    public static function files(User $user): Builder
    {
        $memberIds = self::memberUserIds($user);
        $folderIds = self::folderIds($user);

        $query = FileActivity::query()
            ->with('user')
            ->whereNotIn('action', self::QUIET_FILE_ACTIONS);

        if ($memberIds === [] && $folderIds === []) {
            return $query->whereRaw('1 = 0');
        }

        return $query->where(function (Builder $inner) use ($memberIds, $folderIds) {
            if ($memberIds !== []) {
                $inner->whereIn('user_id', $memberIds);
            }
            if ($folderIds === []) {
                return;
            }

            $inFirm = function (Builder $scope) use ($folderIds) {
                $scope->where(function (Builder $folder) use ($folderIds) {
                    $folder->where('item_type', 'folder')->whereIn('item_id', $folderIds);
                })->orWhere(function (Builder $file) use ($folderIds) {
                    $file->where('item_type', 'file')->whereIn('item_id', function ($sub) use ($folderIds) {
                        $sub->select('id')->from('files')->whereIn('folder_id', $folderIds);
                    });
                });
            };

            if ($memberIds === []) {
                $inner->where($inFirm);
            } else {
                $inner->orWhere($inFirm);
            }
        });
    }

    public static function applyFileFilters(Builder $query, Request $request): void
    {
        if ($from = $request->query('from')) {
            $query->where('created_at', '>=', Carbon::parse($from)->startOfDay());
        }
        if ($to = $request->query('to')) {
            $query->where('created_at', '<=', Carbon::parse($to)->endOfDay());
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $like = '%'.$search.'%';
            $query->where(function (Builder $inner) use ($like) {
                $inner->where('action', 'like', $like)
                    ->orWhere('actor_name', 'like', $like)
                    ->orWhereHas('user', fn (Builder $actor) => $actor->where('name', 'like', $like));
                if (DB::connection()->getDriverName() === 'pgsql') {
                    $inner->orWhereRaw('cast(meta as text) ilike ?', [$like]);
                } else {
                    $inner->orWhere('meta', 'like', $like);
                }
            });
        }
    }

    /**
     * Rows strictly older than the cursor, in the same order the page merges
     * on: newest first, an audit row before a file row at the same second.
     *
     * @param  array{s: string, i: int, t: string}|null  $cursor
     */
    public static function olderThan(Builder $query, string $source, ?array $cursor): void
    {
        if ($cursor === null) {
            return;
        }

        $at = Carbon::parse($cursor['t']);
        $query->where(function (Builder $inner) use ($source, $cursor, $at) {
            $inner->where('created_at', '<', $at);
            $sameSecond = $source === $cursor['s']
                || ($source === 'file' && $cursor['s'] === 'log');
            if (! $sameSecond) {
                return;
            }
            $inner->orWhere(function (Builder $tie) use ($source, $cursor, $at) {
                $tie->where('created_at', $at);
                if ($source === $cursor['s']) {
                    $tie->where('id', '<', $cursor['i']);
                }
            });
        });
    }

    /**
     * @param  iterable<int, ActivityLog>  $logs
     * @param  iterable<int, FileActivity>  $files
     * @return array{items: list<array<string, mixed>>, nextCursor: ?string, isAdmin: bool}
     */
    public static function merge(iterable $logs, iterable $files, int $limit): array
    {
        $names = self::itemNames($files);
        $rows = [];

        foreach ($logs as $log) {
            $rows[] = [
                'at' => $log->created_at,
                'source' => 'log',
                'id' => (int) $log->id,
                'payload' => NotificationPresenter::activity($log, false),
            ];
        }

        foreach ($files as $file) {
            $rows[] = [
                'at' => $file->created_at,
                'source' => 'file',
                'id' => (int) $file->id,
                'payload' => self::presentFile($file, $names),
            ];
        }

        usort($rows, function (array $a, array $b): int {
            $byTime = ($b['at']?->getTimestamp() ?? 0) <=> ($a['at']?->getTimestamp() ?? 0);
            if ($byTime !== 0) {
                return $byTime;
            }
            $bySource = strcmp($b['source'], $a['source']);
            if ($bySource !== 0) {
                return $bySource;
            }

            return $b['id'] <=> $a['id'];
        });

        $hasMore = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $last = $rows === [] ? null : $rows[array_key_last($rows)];

        return [
            'items' => array_map(fn (array $row) => $row['payload'], $rows),
            'nextCursor' => $hasMore && $last && $last['at']
                ? self::encodeCursor($last['source'], $last['id'], $last['at'])
                : null,
            'isAdmin' => false,
        ];
    }

    public static function countNewFiles(User $user, ?Carbon $seenAt): int
    {
        $query = self::files($user);
        if ($seenAt) {
            $query->where('created_at', '>', $seenAt);
        }

        return $query->count();
    }

    /**
     * @return array{s: string, i: int, t: string}|null
     */
    public static function cursor(mixed $raw): ?array
    {
        if (! is_string($raw) || $raw === '' || ctype_digit($raw)) {
            return null;
        }

        $json = base64_decode(strtr($raw, '-_', '+/'), true);
        $data = is_string($json) ? json_decode($json, true) : null;
        if (! is_array($data) || ! isset($data['s'], $data['i'], $data['t'])) {
            return null;
        }
        if (! in_array($data['s'], ['log', 'file'], true)) {
            return null;
        }

        return [
            's' => (string) $data['s'],
            'i' => (int) $data['i'],
            't' => (string) $data['t'],
        ];
    }

    public static function encodeCursor(string $source, int $id, Carbon $at): string
    {
        return rtrim(strtr(base64_encode(json_encode([
            's' => $source,
            'i' => $id,
            't' => $at->toIso8601String(),
        ])), '+/', '-_'), '=');
    }

    /**
     * @return list<int>
     */
    private static function folderIds(User $user): array
    {
        $companyIds = CompanyAccess::companiesFor($user);
        if ($companyIds === []) {
            return [];
        }

        $clientIds = self::clientIds($user);
        $roots = [];
        if ($clientIds !== []) {
            $roots = array_merge(
                $roots,
                Folder::withTrashed()->whereIn('client_id', $clientIds)->pluck('id')->all(),
                Client::query()->whereIn('id', $clientIds)->whereNotNull('folder_id')->pluck('folder_id')->all(),
            );
        }

        $providerIds = CipProvider::query()->whereIn('company_id', $companyIds)->pluck('id');
        $roots = array_merge(
            $roots,
            CipProvider::query()->whereIn('company_id', $companyIds)->whereNotNull('folder_id')->pluck('folder_id')->all(),
        );
        if ($providerIds->isNotEmpty()) {
            $applications = CipApplication::withTrashed()
                ->whereIn('provider_id', $providerIds)
                ->get(['folder_id', 'post_approval_folder_id']);
            foreach ($applications as $application) {
                if ($application->folder_id) {
                    $roots[] = (int) $application->folder_id;
                }
                if ($application->post_approval_folder_id) {
                    $roots[] = (int) $application->post_approval_folder_id;
                }
            }
        }

        return self::expandFolders($roots);
    }

    /**
     * @param  list<int|string|null>  $roots
     * @return list<int>
     */
    private static function expandFolders(array $roots): array
    {
        $seen = [];
        $frontier = [];
        foreach ($roots as $id) {
            $id = (int) $id;
            if ($id > 0 && ! isset($seen[$id])) {
                $seen[$id] = true;
                $frontier[] = $id;
            }
        }

        while ($frontier !== []) {
            $children = Folder::withTrashed()
                ->whereIn('parent_id', $frontier)
                ->pluck('id')
                ->all();
            $frontier = [];
            foreach ($children as $id) {
                $id = (int) $id;
                if ($id > 0 && ! isset($seen[$id])) {
                    $seen[$id] = true;
                    $frontier[] = $id;
                }
            }
        }

        return array_keys($seen);
    }

    /**
     * @param  iterable<int, FileActivity>  $files
     * @return array{file: array<int, string>, folder: array<int, string>}
     */
    private static function itemNames(iterable $files): array
    {
        $fileIds = [];
        $folderIds = [];
        foreach ($files as $file) {
            if ($file->item_type === 'folder') {
                $folderIds[] = (int) $file->item_id;
            } else {
                $fileIds[] = (int) $file->item_id;
            }
        }

        return [
            'file' => $fileIds === []
                ? []
                : FileItem::withTrashed()->whereIn('id', $fileIds)->pluck('name', 'id')->all(),
            'folder' => $folderIds === []
                ? []
                : Folder::withTrashed()->whereIn('id', $folderIds)->pluck('name', 'id')->all(),
        ];
    }

    /**
     * @param  array{file: array<int, string>, folder: array<int, string>}  $names
     * @return array<string, mixed>
     */
    private static function presentFile(FileActivity $activity, array $names): array
    {
        $key = $activity->item_type === 'folder' ? 'folder' : 'file';
        $name = $names[$key][(int) $activity->item_id] ?? null;
        $actor = NotificationPresenter::actor($activity->user);
        if ($actor === null && $activity->actor_name) {
            $actor = ['id' => null, 'name' => $activity->actor_name, 'avatar' => null];
        }

        return [
            'id' => 'file-'.$activity->id,
            'type' => 'file.'.$activity->action,
            'module' => 'files',
            'action' => $activity->action,
            'status' => ActivityLog::STATUS_SUCCESS,
            'description' => self::fileDescription($activity, $name),
            'isSystem' => $actor === null,
            'actor' => $actor,
            'client' => null,
            'subjectType' => $activity->item_type === 'folder' ? 'Folder' : 'FileItem',
            'subjectId' => $activity->item_id,
            'ip' => null,
            'device' => null,
            'location' => null,
            'postal' => null,
            'latitude' => null,
            'longitude' => null,
            'oldValues' => null,
            'newValues' => null,
            'createdAt' => $activity->created_at?->toIso8601String(),
        ];
    }

    private static function fileDescription(FileActivity $activity, ?string $name): string
    {
        $meta = $activity->meta ?: [];
        $label = '“'.($name ?: (is_string($meta['name'] ?? null) ? $meta['name'] : 'a file')).'”';

        return match ($activity->action) {
            'upload' => 'uploaded '.$label,
            'rename' => isset($meta['from'])
                ? 'renamed “'.$meta['from'].'” to '.$label
                : 'renamed '.$label,
            'move' => isset($meta['to']) ? 'moved '.$label.' to “'.$meta['to'].'”' : 'moved '.$label,
            'copy' => 'copied '.$label,
            'replaced', 'version' => 'updated '.$label,
            'version-restored' => 'restored an earlier version of '.$label,
            'delete', 'recycle' => 'moved '.$label.' to the Recycle Bin',
            'restore' => 'restored '.$label,
            'purge' => 'permanently deleted '.$label,
            'comment', 'comment-reply' => 'commented on '.$label,
            'share', 'assign' => 'shared '.$label,
            default => str_replace('-', ' ', (string) $activity->action).' '.$label,
        };
    }
}
