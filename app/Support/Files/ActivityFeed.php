<?php

namespace App\Support\Files;

use App\Models\FileActivity;
use App\Models\FileItem;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * The file activity timeline: one page of real, human-readable history for a
 * single file, filtered by kind and grouped into the date bands the viewer
 * renders ("Today", "Yesterday", "This week", …).
 *
 * Reads `file_activities`, which the file manager has been writing since it was
 * built — nothing here invents or backfills events. A file with no history
 * returns an empty page, never placeholder rows.
 */
class ActivityFeed
{
    /** Rows per page. The panel lazy-loads more as the user scrolls. */
    public const PER_PAGE = 20;

    /**
     * Filter name => the raw `file_activities.action` values it covers.
     *
     * Later phases add their own actions (comments, versions, approvals,
     * signatures). Their filters are declared here already so the dropdown
     * has a stable shape; an empty result reads as "nothing yet" rather than
     * the filter being missing.
     */
    public const FILTERS = [
        'all' => [],
        'comments' => ['comment', 'comment-reply', 'comment-resolved'],
        'shares' => ['share', 'link', 'revoked', 'permission'],
        'edits' => ['rename', 'move', 'copy', 'colour', 'icon', 'replaced'],
        'versions' => ['upload', 'version', 'version-restored'],
        'approvals' => ['approval-sent', 'approved', 'declined', 'changes-requested'],
        'signatures' => ['signature-sent', 'signed', 'signature-declined'],
        'downloads' => ['download', 'zip', 'print'],
        'access' => ['share', 'revoked', 'permission', 'assign'],
    ];

    /** Filters offered in the "View:" dropdown, in order. */
    public static function options(): array
    {
        return [
            ['value' => 'all', 'label' => 'All activity'],
            ['value' => 'comments', 'label' => 'Comments'],
            ['value' => 'shares', 'label' => 'Shares'],
            ['value' => 'edits', 'label' => 'Edits'],
            ['value' => 'versions', 'label' => 'Versions'],
            ['value' => 'approvals', 'label' => 'Approvals'],
            ['value' => 'signatures', 'label' => 'Signatures'],
            ['value' => 'downloads', 'label' => 'Downloads'],
            ['value' => 'access', 'label' => 'Access changes'],
        ];
    }

    /**
     * One page of activity, newest first.
     *
     * Paged by `before` (an activity id) rather than an offset: the timeline
     * grows while it is open, and an offset would re-show or skip rows every
     * time something new lands at the top.
     *
     * @return array{entries: list<array>, nextCursor: ?int, filter: string}
     */
    public static function page(FileItem $file, User $viewer, string $filter = 'all', ?int $before = null): array
    {
        $filter = isset(self::FILTERS[$filter]) ? $filter : 'all';
        $actions = self::FILTERS[$filter];

        $rows = FileActivity::query()
            ->where('item_type', 'file')
            ->where('item_id', $file->id)
            ->when($actions !== [], fn ($q) => $q->whereIn('action', $actions))
            ->when($before !== null, fn ($q) => $q->where('id', '<', $before))
            // photoUrl() reads both columns — selecting only one silently
            // drops every provider photo back to initials.
            ->with('user:id,name,email,avatar_url,provider_avatar_url')
            ->orderByDesc('id')
            // One extra row tells us whether another page exists without a
            // second count query.
            ->limit(self::PER_PAGE + 1)
            ->get();

        $hasMore = $rows->count() > self::PER_PAGE;
        $rows = $rows->take(self::PER_PAGE);

        return [
            'filter' => $filter,
            'entries' => $rows->map(fn (FileActivity $a) => self::entry($a, $viewer))->values()->all(),
            'nextCursor' => $hasMore ? $rows->last()->id : null,
        ];
    }

    /** @return array<string, mixed> */
    private static function entry(FileActivity $activity, User $viewer): array
    {
        $at = $activity->created_at ?: now();
        $actor = $activity->user;

        return [
            'id' => $activity->id,
            'action' => $activity->action,
            'text' => self::sentence($activity, $viewer),
            // `name` stays the real name even for the viewer's own actions:
            // the client renders the word "You" from `isSelf`, but the avatar
            // has to fall back to *their* initials, not to "Y" for "You".
            'actor' => $actor ? [
                'name' => $actor->name,
                'isSelf' => $actor->id === $viewer->id,
                'email' => $actor->email,
                'avatar' => $actor->photoUrl(),
            ] : null,
            'icon' => self::icon($activity->action),
            'meta' => $activity->meta ?: null,
            'at' => $at->toIso8601String(),
            'group' => self::band($at),
        ];
    }

    /**
     * "Vernon Francis renamed this file" — the actor is rendered separately by
     * the panel, so this is only the predicate.
     */
    private static function sentence(FileActivity $activity, User $viewer): string
    {
        $meta = $activity->meta ?: [];

        return match ($activity->action) {
            'upload' => 'uploaded this file',
            'download' => 'downloaded this file',
            'preview' => 'previewed this file',
            'zip' => 'downloaded this file in a zip',
            'print' => 'printed this file',
            'rename' => isset($meta['from'], $meta['to'])
                ? 'renamed this file from “'.$meta['from'].'” to “'.$meta['to'].'”'
                : 'renamed this file',
            'move' => isset($meta['to']) ? 'moved this file to “'.$meta['to'].'”' : 'moved this file',
            'copy' => isset($meta['as']) ? 'copied this file as “'.$meta['as'].'”' : 'copied this file',
            'replaced' => 'replaced this file',
            'recycle', 'delete' => 'moved this file to the Recycle Bin',
            'restore' => 'restored this file',
            'purge' => 'permanently deleted this file',
            'share' => isset($meta['to']) ? 'shared this file with '.$meta['to'] : 'shared this file',
            'link' => 'created a sharing link',
            'revoked' => 'removed access',
            'permission' => isset($meta['role']) ? 'changed a permission to '.$meta['role'] : 'changed a permission',
            'colour' => 'changed the colour',
            'icon' => 'changed the icon',
            default => str_replace('-', ' ', $activity->action),
        };
    }

    /** Phosphor icon for actions with no actor avatar to show. */
    private static function icon(string $action): string
    {
        return match ($action) {
            'upload', 'version' => 'ArrowLineUp',
            'download', 'zip' => 'ArrowLineDown',
            'share', 'link' => 'ShareNetwork',
            'rename' => 'PencilSimple',
            'move' => 'FolderNotch',
            'copy' => 'Copy',
            'recycle', 'delete', 'purge' => 'Trash',
            'restore' => 'ArrowCounterClockwise',
            'revoked', 'permission' => 'Lock',
            'print' => 'Printer',
            default => 'ClockCounterClockwise',
        };
    }

    /**
     * The date band a timestamp belongs in. The spec asks for "Today",
     * "Yesterday", "This week", "Three weeks ago" — relative bands, so they
     * stay meaningful as the file ages.
     */
    private static function band(Carbon $at): string
    {
        $now = now();

        if ($at->isSameDay($now)) {
            return 'Today';
        }
        if ($at->isSameDay($now->copy()->subDay())) {
            return 'Yesterday';
        }
        if ($at->greaterThan($now->copy()->subWeek())) {
            return 'This week';
        }
        if ($at->greaterThan($now->copy()->subWeeks(2))) {
            return 'Last week';
        }
        if ($at->greaterThan($now->copy()->subMonth())) {
            $weeks = max(2, (int) $at->diffInWeeks($now));

            return $weeks.' weeks ago';
        }
        if ($at->greaterThan($now->copy()->subYear())) {
            return $at->format('F Y');
        }

        return $at->format('Y');
    }
}
