<?php

namespace App\Support\Files;

use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\FileWorkflow;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\Workflow\Status;
use App\Support\UserTime;
use Illuminate\Support\Carbon;

/**
 * The "More details" metadata block in the file viewer.
 *
 * Every value here is read from the record. Fields that do not apply to a file
 * are omitted rather than rendered as a placeholder — the spec is explicit that
 * only applicable fields show, and an "—" against "SharePoint item ID" on a
 * file that was never in SharePoint reads as a sync failure.
 *
 * Fields that later phases fill in (version, sync state, retention,
 * classification, related records) are declared as `null` here and skipped by
 * the renderer, so the shape is stable while the data catches up.
 */
class FileDetails
{
    /** @return array<string, mixed> */
    public static function for(FileItem $file, User $viewer): array
    {
        $folder = $file->folder;

        return [
            /*
             * What the other tabs hold, so the Details panel can say so without
             * the reader opening each one.
             *
             * Carried here rather than fetched separately because this request
             * is already being made when the panel opens — three more round
             * trips to render three numbers would cost more than the numbers
             * are worth.
             *
             * "Open" comments, not all of them: a resolved thread is finished
             * business, and counting it would leave a file reading "3 comments"
             * forever after the discussion ended. Same definition the Comments
             * tab badge uses — see CommentPresenter::thread().
             */
            'counts' => [
                'comments' => FileComment::where('file_id', $file->id)
                    ->whereColumn('id', 'root_id')
                    ->whereNull('resolved_at')
                    ->count(),
                'versions' => FileVersion::where('file_id', $file->id)->count(),
                /*
                 * Still open, by the same definition the panel uses.
                 *
                 * This previously excluded status 'closed' — a value that does
                 * not exist. The finished states are Status::TERMINAL
                 * (approved, changes_requested, declined, signed,
                 * acknowledged, completed), so every workflow ever created
                 * counted as open and the tab claimed outstanding approvals on
                 * files that had none.
                 */
                'approvals' => FileWorkflow::where('file_id', $file->id)
                    ->whereNotIn('status', Status::TERMINAL)
                    ->count(),
            ],
            'groups' => array_values(array_filter([
                self::group('File', [
                    self::row('File name', $file->name),
                    self::row('File type', FileType::label((string) $file->extension)),
                    self::row('MIME type', $file->mime_type),
                    self::row('File size', Presenter::humanSize((int) $file->size)),
                    self::row('Checksum', $file->checksum ? substr($file->checksum, 0, 16).'…' : null),
                ]),
                self::group('Location', [
                    self::row('Portal path', self::portalPath($folder)),
                    self::row('Folder', $folder?->name ?? 'File Box'),
                    self::row('Folder type', $folder ? self::folderTypeLabel($folder) : null),
                    // Phase 10 fills these in from the item mapping.
                    self::row('Document library', null),
                    self::row('SharePoint path', null),
                ]),
                self::group('History', [
                    self::row('Created', self::datetime($file->created_at, $viewer)),
                    self::row('Created by', $file->uploader?->name),
                    self::row('Modified', self::datetime($file->source_modified_at ?? $file->updated_at, $viewer)),
                    self::row('Modified by', $file->uploader?->name),
                    self::row('Owner', $file->owner?->name),
                    // Phase 3.
                    self::row('Current version', null),
                ]),
                self::group('Record', [
                    self::row('Record ID', $file->uuid),
                    // Phases 10-11.
                    self::row('SharePoint item ID', null),
                    self::row('Sync status', null),
                    self::row('Last successful sync', null),
                    self::row('Classification', null),
                    self::row('Retention status', null),
                ]),
                self::group('Related', self::related($folder)),
            ], fn (array $g) => $g['rows'] !== [])),
        ];
    }

    /**
     * Records this file is connected to. Today the only real link is the client
     * that owns the containing folder; bookings, events, artists, contracts and
     * invoices are listed in the spec but have no schema yet, so they are
     * deliberately absent rather than shown empty.
     */
    private static function related(?Folder $folder): array
    {
        $client = null;

        $node = $folder;
        $seen = [];
        while ($node !== null && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            if ($node->folder_type === Folder::TYPE_CLIENT && $node->client) {
                $client = $node->client;
                break;
            }
            $node = $node->parent;
        }

        return array_values(array_filter([
            self::row('Related client', $client?->name),
        ]));
    }

    private static function portalPath(?Folder $folder): string
    {
        if (! $folder) {
            return 'File Box';
        }

        $parts = [];
        $seen = [];
        $node = $folder;

        while ($node !== null && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            array_unshift($parts, $node->name);
            $node = $node->parent;
        }

        return '/'.implode('/', $parts);
    }

    private static function folderTypeLabel(Folder $folder): string
    {
        return match ($folder->folder_type) {
            Folder::TYPE_ORGANIZATION => 'Organization folder',
            Folder::TYPE_CLIENT => 'Client folder',
            Folder::TYPE_STAFF => 'Staff folder',
            Folder::TYPE_ROOT => 'Root folder',
            default => 'Personal folder',
        };
    }

    /**
     * A date somebody can read, in their own zone.
     *
     * This was toIso8601String(), so the panel showed
     * "2026-08-08T22:09:15+00:00" against Created and Modified — a machine
     * value in a place people go to answer "when was this last touched?", and
     * in UTC rather than the reader's zone, so it was also wrong by however
     * far they sit from Greenwich.
     *
     * UserTime is the one display-zone helper; see the note on the class.
     */
    private static function datetime(mixed $value, ?User $viewer): ?string
    {
        if (! $value instanceof Carbon) {
            return null;
        }

        return UserTime::format($value, $viewer, 'M j, Y \a\t g:i A');
    }

    /** A row with no value is dropped by the group filter below. */
    private static function row(string $label, ?string $value): ?array
    {
        return $value === null || $value === '' ? null : ['label' => $label, 'value' => $value];
    }

    private static function group(string $title, array $rows): array
    {
        return ['title' => $title, 'rows' => array_values(array_filter($rows))];
    }
}
