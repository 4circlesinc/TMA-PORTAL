<?php

namespace App\Support\Smartsheet;

use App\Models\SmartsheetAttachment;
use App\Models\SmartsheetComment;
use App\Models\SmartsheetDiscussion;
use App\Models\SmartsheetRow;
use App\Models\SmartsheetSheet;
use App\Models\SmartsheetSyncLog;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * One-way inbound sync: Smartsheet → the mirror tables. The portal never
 * writes back — Smartsheet is being retired, not partnered with.
 *
 * Change detection is two-tier. The workspace walk (one request) discovers
 * sheets and their folder paths; per sheet, the cheap /version endpoint says
 * whether anything changed at all. Only a changed sheet pays for a full
 * fetch, which is what keeps ~300 sheets inside the 300 req/min budget.
 */
class Synchroniser
{
    /** A sync marked 'syncing' older than this is presumed dead and taken over. */
    private const LOCK_MINUTES = 30;

    /**
     * Walk the workspace tree, upsert every sheet with its folder path and
     * category, and mark sheets that vanished remotely. Returns the sheets
     * whose remote version moved past what we've stored.
     *
     * @return list<SmartsheetSheet>
     */
    public static function refreshWorkspace(?string $runId = null): array
    {
        $workspaceId = (string) config('services.smartsheet.workspace_id');
        $payload = Client::get('/workspaces/'.$workspaceId, ['loadAll' => 'true']);

        $seen = [];
        self::walkFolder($payload, '', $seen);

        // Remote deletions: a sheet we mirror that the walk no longer finds.
        // Mirror data is kept — this archive outlives the Smartsheet account.
        SmartsheetSheet::query()
            ->whereNotIn('remote_id', array_keys($seen))
            ->where('status', '!=', SmartsheetSheet::STATUS_GONE)
            ->get()
            ->each(function (SmartsheetSheet $sheet) use ($runId) {
                $sheet->update(['status' => SmartsheetSheet::STATUS_GONE]);
                self::log($sheet, 'sheet-gone', 'warning', 'Sheet no longer present in the workspace.', [], $runId);
            });

        $due = SmartsheetSheet::query()
            ->where('sync_enabled', true)
            ->where('status', '!=', SmartsheetSheet::STATUS_GONE)
            ->where(function ($q) {
                $q->whereNull('synced_version')
                    ->orWhereColumn('version', '!=', 'synced_version');
            })
            ->orderByRaw('synced_version IS NOT NULL')   // never-synced sheets first
            ->orderBy('modified_at_remote', 'desc')
            ->get()
            ->all();

        self::log(null, 'workspace-walk', 'info',
            count($seen).' sheet(s) in workspace, '.count($due).' due for sync.', [], $runId);

        return $due;
    }

    /** @param array<int, true> $seen */
    private static function walkFolder(array $node, string $path, array &$seen): void
    {
        foreach ($node['sheets'] ?? [] as $sheet) {
            $seen[(int) $sheet['id']] = true;
            SmartsheetSheet::updateOrCreate(
                ['remote_id' => (int) $sheet['id']],
                [
                    'name' => (string) $sheet['name'],
                    'permalink' => $sheet['permalink'] ?? null,
                    'folder_path' => $path,
                    'category' => self::classify($path, (string) $sheet['name']),
                    // The walk's modifiedAt is advisory; /version decides.
                    'modified_at_remote' => isset($sheet['modifiedAt'])
                        ? CarbonImmutable::parse($sheet['modifiedAt']) : null,
                    'created_at_remote' => isset($sheet['createdAt'])
                        ? CarbonImmutable::parse($sheet['createdAt']) : null,
                ],
            );
        }

        foreach ($node['folders'] ?? [] as $folder) {
            $sub = $path === '' ? (string) $folder['name'] : $path.'/'.$folder['name'];
            self::walkFolder($folder, $sub, $seen);
        }
        // Reports are saved views over sheets — derived data, never synced.
    }

    /**
     * Folder placement is the primary signal (the firm files by stage);
     * "ASSESSMENT FEEDBACK" in the name catches the many per-applicant
     * assessment sheets that live loose at the workspace root.
     */
    public static function classify(string $folderPath, string $name): string
    {
        $top = strtoupper(Str::before($folderPath, '/'));
        $upperName = strtoupper($name);

        return match (true) {
            str_starts_with($top, 'APPLICATION ASSESSMENTS') => SmartsheetSheet::CATEGORY_ASSESSMENT,
            str_starts_with($top, 'CLOSED APPLICATIONS') => SmartsheetSheet::CATEGORY_CLOSED,
            str_starts_with($top, 'MASTER TRACKERS') => SmartsheetSheet::CATEGORY_MASTER_TRACKER,
            str_starts_with($top, 'SUBMISSION') => SmartsheetSheet::CATEGORY_SUBMISSION,
            str_starts_with($top, 'POST APPROVAL') => SmartsheetSheet::CATEGORY_POST_APPROVAL,
            str_contains($upperName, 'ASSESSMENT FEEDBACK') => SmartsheetSheet::CATEGORY_ASSESSMENT,
            str_contains($upperName, 'PENDING REVIEW') => SmartsheetSheet::CATEGORY_PENDING_REVIEW,
            str_contains($upperName, 'CLOSED APPLICATIONS') => SmartsheetSheet::CATEGORY_CLOSED,
            default => SmartsheetSheet::CATEGORY_OTHER,
        };
    }

    /**
     * Sync one sheet into the mirror. Returns:
     *  'unchanged' | 'synced' | 'locked' | 'throttled' | 'failed'
     *
     * Throttling is reported, not thrown — the job re-dispatches itself with
     * the Retry-After delay instead of burning a retry (SharePoint pattern).
     *
     * @return array{status: string, retryAfter?: int}
     */
    public static function syncSheet(SmartsheetSheet $sheet, ?string $runId = null, bool $force = false): array
    {
        // Status-column lock with a staleness window — deliberately not a
        // cache lock, so a run that died mid-sync is taken over, not waited on.
        $sheet->refresh();
        if ($sheet->status === SmartsheetSheet::STATUS_SYNCING) {
            if ($sheet->last_synced_at?->gt(now()->subMinutes(self::LOCK_MINUTES))) {
                return ['status' => 'locked'];
            }
            self::log($sheet, 'lock-recovered', 'warning', 'Taking over a stale sync.', [], $runId);
        }

        try {
            $version = (int) (Client::get('/sheets/'.$sheet->remote_id.'/version')['version'] ?? 0);
            if (! $force && $sheet->synced_version !== null && $version === (int) $sheet->synced_version) {
                $sheet->update(['version' => $version, 'last_synced_at' => now()]);

                return ['status' => 'unchanged'];
            }

            $sheet->update(['status' => SmartsheetSheet::STATUS_SYNCING, 'last_synced_at' => now()]);

            $incremental = ! $force && $sheet->synced_version !== null && $sheet->last_success_at !== null;
            $query = ['include' => 'attachments,rowPermalink'];
            if ($incremental) {
                // Overlap the window a minute so a row modified while the
                // previous pass ran is never missed.
                $query['rowsModifiedSince'] = $sheet->last_success_at
                    ->subMinute()->utc()->format('Y-m-d\TH:i:s\Z');
            }

            $payload = Client::get('/sheets/'.$sheet->remote_id, $query);

            self::applyColumns($sheet, $payload['columns'] ?? []);
            $rowCount = self::applyRows($sheet, $payload['rows'] ?? []);
            self::applyAttachments($sheet, $payload);

            /*
             * rowsModifiedSince never reports deletions or moves-away, so an
             * incremental pass reconciles ids whenever the remote row count
             * disagrees with ours — one extra request fetching only the
             * primary column, not the whole sheet.
             */
            $remoteTotal = (int) ($payload['totalRowCount'] ?? 0);
            if (! $incremental) {
                self::pruneRows($sheet, collect($payload['rows'] ?? [])->pluck('id')->all(), $runId);
            } elseif ($remoteTotal !== $sheet->rows()->count()) {
                self::reconcileRowIds($sheet, $runId);
            }

            // Comments bump the sheet version but not any row's modifiedAt,
            // so discussions re-sync on every changed pass.
            self::applyDiscussions($sheet, $runId);

            // Success = the whole pass landed; only then does synced_version
            // advance. A partial pass re-fetches from the same version.
            $sheet->update([
                'version' => $version,
                'synced_version' => $version,
                'row_count' => $remoteTotal,
                'status' => SmartsheetSheet::STATUS_IDLE,
                'last_success_at' => now(),
                'last_error' => null,
                'error_count' => 0,
            ]);

            self::log($sheet, $incremental ? 'sync-incremental' : 'sync-full', 'info',
                $rowCount.' row(s) applied at version '.$version.'.', [], $runId);

            return ['status' => 'synced'];
        } catch (SmartsheetThrottledException $e) {
            $sheet->update(['status' => SmartsheetSheet::STATUS_IDLE]);
            self::log($sheet, 'throttled', 'warning', $e->getMessage(),
                ['retry_after' => $e->retryAfter], $runId);

            return ['status' => 'throttled', 'retryAfter' => $e->retryAfter];
        } catch (Throwable $e) {
            $sheet->update([
                'status' => SmartsheetSheet::STATUS_ERROR,
                'last_error' => Str::limit($e->getMessage(), 500),
                'error_count' => $sheet->error_count + 1,
            ]);
            self::log($sheet, 'sync-failed', 'error', Str::limit($e->getMessage(), 1000), [], $runId);
            Log::error('Smartsheet sync failed', ['sheet' => $sheet->remote_id, 'error' => $e->getMessage()]);

            return ['status' => 'failed'];
        }
    }

    /** @param list<array<string, mixed>> $columns */
    private static function applyColumns(SmartsheetSheet $sheet, array $columns): void
    {
        foreach ($columns as $column) {
            $sheet->columns()->updateOrCreate(
                ['remote_id' => (int) $column['id']],
                [
                    'title' => (string) $column['title'],
                    'type' => (string) ($column['type'] ?? 'TEXT_NUMBER'),
                    'options' => $column['options'] ?? null,
                    'position' => (int) ($column['index'] ?? 0),
                    'is_primary' => (bool) ($column['primary'] ?? false),
                ],
            );
        }
    }

    /** @param list<array<string, mixed>> $rows */
    private static function applyRows(SmartsheetSheet $sheet, array $rows): int
    {
        $applied = 0;
        foreach ($rows as $row) {
            // Sparse cell map: only cells that hold anything. ~40 of 210 on a
            // typical tracker row — the other 170 would be pure dead weight.
            $cells = [];
            foreach ($row['cells'] ?? [] as $cell) {
                $entry = [];
                if (array_key_exists('value', $cell)) {
                    $entry['v'] = $cell['value'];
                }
                if (array_key_exists('displayValue', $cell)) {
                    $entry['d'] = $cell['displayValue'];
                }
                if ($entry !== []) {
                    $cells[(string) $cell['columnId']] = $entry;
                }
            }

            $sheet->rows()->updateOrCreate(
                ['remote_id' => (int) $row['id']],
                [
                    'row_number' => (int) ($row['rowNumber'] ?? 0),
                    'parent_remote_id' => isset($row['parentId']) ? (int) $row['parentId'] : null,
                    'cells' => $cells,
                    'permalink' => $row['permalink'] ?? null,
                    'created_at_remote' => isset($row['createdAt']) ? CarbonImmutable::parse($row['createdAt']) : null,
                    'modified_at_remote' => isset($row['modifiedAt']) ? CarbonImmutable::parse($row['modifiedAt']) : null,
                    'synced_at' => now(),
                ],
            );

            foreach ($row['attachments'] ?? [] as $attachment) {
                self::applyAttachment($sheet, $attachment, 'ROW', (int) $row['id']);
            }

            $applied++;
        }

        return $applied;
    }

    /** @param array<string, mixed> $payload */
    private static function applyAttachments(SmartsheetSheet $sheet, array $payload): void
    {
        foreach ($payload['attachments'] ?? [] as $attachment) {
            self::applyAttachment($sheet, $attachment, 'SHEET', null);
        }
    }

    /** @param array<string, mixed> $attachment */
    private static function applyAttachment(SmartsheetSheet $sheet, array $attachment, string $parentType, ?int $parentRemoteId): void
    {
        SmartsheetAttachment::updateOrCreate(
            ['remote_id' => (int) $attachment['id']],
            [
                'sheet_id' => $sheet->id,
                'parent_type' => (string) ($attachment['parentType'] ?? $parentType),
                'parent_remote_id' => isset($attachment['parentId']) ? (int) $attachment['parentId'] : $parentRemoteId,
                'name' => (string) ($attachment['name'] ?? 'Attachment'),
                'mime_type' => $attachment['mimeType'] ?? null,
                'attachment_type' => $attachment['attachmentType'] ?? null,
                'size_kb' => isset($attachment['sizeInKb']) ? (int) $attachment['sizeInKb'] : null,
                'created_by' => $attachment['createdBy']['email'] ?? $attachment['createdBy']['name'] ?? null,
                'created_at_remote' => isset($attachment['createdAt']) ? CarbonImmutable::parse($attachment['createdAt']) : null,
            ],
        );
    }

    private static function applyDiscussions(SmartsheetSheet $sheet, ?string $runId): void
    {
        $discussions = Client::getAll('/sheets/'.$sheet->remote_id.'/discussions', ['include' => 'comments']);

        foreach ($discussions as $discussion) {
            $record = SmartsheetDiscussion::updateOrCreate(
                ['remote_id' => (int) $discussion['id']],
                [
                    'sheet_id' => $sheet->id,
                    'parent_type' => (string) ($discussion['parentType'] ?? 'SHEET'),
                    'parent_remote_id' => isset($discussion['parentId']) ? (int) $discussion['parentId'] : null,
                    'title' => $discussion['title'] ?? null,
                    'comment_count' => (int) ($discussion['commentCount'] ?? 0),
                    'created_by' => $discussion['createdBy']['email'] ?? $discussion['createdBy']['name'] ?? null,
                    'last_commented_at' => isset($discussion['lastCommentedAt'])
                        ? CarbonImmutable::parse($discussion['lastCommentedAt']) : null,
                ],
            );

            foreach ($discussion['comments'] ?? [] as $comment) {
                SmartsheetComment::updateOrCreate(
                    ['remote_id' => (int) $comment['id']],
                    [
                        'discussion_id' => $record->id,
                        'sheet_id' => $sheet->id,
                        'text' => (string) ($comment['text'] ?? ''),
                        'created_by_name' => $comment['createdBy']['name'] ?? null,
                        'created_by_email' => $comment['createdBy']['email'] ?? null,
                        'created_at_remote' => isset($comment['createdAt']) ? CarbonImmutable::parse($comment['createdAt']) : null,
                        'modified_at_remote' => isset($comment['modifiedAt']) ? CarbonImmutable::parse($comment['modifiedAt']) : null,
                    ],
                );
            }
        }
    }

    /** @param list<int|string> $remoteIds */
    private static function pruneRows(SmartsheetSheet $sheet, array $remoteIds, ?string $runId): void
    {
        $gone = $sheet->rows()->whereNotIn('remote_id', array_map('intval', $remoteIds))->delete();
        if ($gone > 0) {
            self::log($sheet, 'rows-pruned', 'info', $gone.' row(s) no longer on the sheet.', [], $runId);
        }
    }

    /**
     * Cheap id sweep after an incremental pass whose counts disagree:
     * fetch every row id (primary column only) and drop local rows that
     * vanished — usually rows moved to a closed sheet.
     */
    private static function reconcileRowIds(SmartsheetSheet $sheet, ?string $runId): void
    {
        $primary = $sheet->columns()->where('is_primary', true)->value('remote_id')
            ?? $sheet->columns()->orderBy('position')->value('remote_id');
        if ($primary === null) {
            return;
        }

        $payload = Client::get('/sheets/'.$sheet->remote_id, ['columnIds' => (string) $primary]);
        self::pruneRows($sheet, collect($payload['rows'] ?? [])->pluck('id')->all(), $runId);
    }

    /** @param array<string, mixed> $meta */
    public static function log(?SmartsheetSheet $sheet, string $action, string $level, string $detail, array $meta = [], ?string $runId = null): void
    {
        SmartsheetSyncLog::create([
            'sheet_id' => $sheet?->id,
            'run_id' => $runId,
            'action' => $action,
            'level' => $level,
            'detail' => Str::limit($detail, 1000),
            'meta' => $meta === [] ? null : $meta,
            'created_at' => now(),
        ]);
    }
}
