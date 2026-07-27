<?php

namespace App\Support;

use App\Models\CalendarEvent;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Group;
use App\Models\MessageAttachment;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Files\FolderTree;
use App\Support\Files\Vault;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * Firm-wide soft-deleted items for administrators (Overview → Recycle Bin).
 *
 * Email and chat messages themselves are excluded. Message *files* are included
 * via MessageAttachment soft deletes.
 */
class AdminRecycleBin
{
    public const KINDS = [
        'file',
        'folder',
        'client',
        'signature',
        'group',
        'calendar_event',
        'message_attachment',
    ];

    private const PER_KIND = 150;

    /** @return array{items: list<array<string, mixed>>, total: int} */
    public static function list(?string $search = null, ?string $kind = null): array
    {
        $search = trim((string) $search);
        $kind = $kind && in_array($kind, self::KINDS, true) ? $kind : null;

        $chunks = collect();
        if (! $kind || $kind === 'file') {
            $chunks = $chunks->merge(self::files($search));
        }
        if (! $kind || $kind === 'folder') {
            $chunks = $chunks->merge(self::folders($search));
        }
        if (! $kind || $kind === 'client') {
            $chunks = $chunks->merge(self::clients($search));
        }
        if (! $kind || $kind === 'signature') {
            $chunks = $chunks->merge(self::signatures($search));
        }
        if (! $kind || $kind === 'group') {
            $chunks = $chunks->merge(self::groups($search));
        }
        if (! $kind || $kind === 'calendar_event') {
            $chunks = $chunks->merge(self::calendarEvents($search));
        }
        if (! $kind || $kind === 'message_attachment') {
            $chunks = $chunks->merge(self::messageAttachments($search));
        }

        $sorted = $chunks
            ->sortByDesc(fn (array $row) => $row['deletedAt'] ?? '')
            ->values();

        return [
            'items' => $sorted->all(),
            'total' => $sorted->count(),
        ];
    }

    public static function restore(string $kind, string $id): void
    {
        match ($kind) {
            'file' => self::restoreFile($id),
            'folder' => self::restoreFolder($id),
            'client' => self::restoreClient($id),
            'signature' => self::restoreSignature($id),
            'group' => self::restoreGroup($id),
            'calendar_event' => self::restoreCalendarEvent($id),
            'message_attachment' => self::restoreMessageAttachment($id),
            default => abort(404, 'Unknown recycle kind.'),
        };
    }

    public static function purge(string $kind, string $id): void
    {
        match ($kind) {
            'file' => self::purgeFile($id),
            'folder' => self::purgeFolder($id),
            'client' => self::purgeClient($id),
            'signature' => self::purgeSignature($id),
            'group' => self::purgeGroup($id),
            'calendar_event' => self::purgeCalendarEvent($id),
            'message_attachment' => self::purgeMessageAttachment($id),
            default => abort(404, 'Unknown recycle kind.'),
        };
    }

    /** @return array{files: int, folders: int, clients: int, signatures: int, groups: int, calendar_events: int, message_attachments: int} */
    public static function empty(?array $kinds = null): array
    {
        $kinds = $kinds ? array_values(array_intersect(self::KINDS, $kinds)) : self::KINDS;
        $counts = [
            'files' => 0,
            'folders' => 0,
            'clients' => 0,
            'signatures' => 0,
            'groups' => 0,
            'calendar_events' => 0,
            'message_attachments' => 0,
        ];

        if (in_array('file', $kinds, true)) {
            $files = FileItem::onlyTrashed()->limit(500)->get();
            $files->each(fn (FileItem $f) => Vault::delete($f));
            $counts['files'] = $files->count();
            FileItem::onlyTrashed()->whereIn('id', $files->pluck('id'))->forceDelete();
        }
        if (in_array('folder', $kinds, true)) {
            $trashed = self::trashedFolderIds();
            $folders = Folder::onlyTrashed()
                ->where(fn ($q) => $q->whereNull('parent_id')->orWhereNotIn('parent_id', $trashed ?: [0]))
                ->limit(200)->get();
            foreach ($folders as $folder) {
                FolderTree::purgeTree($folder);
                $counts['folders']++;
            }
        }
        if (in_array('client', $kinds, true)) {
            $counts['clients'] = Client::onlyTrashed()->limit(500)->forceDelete();
        }
        if (in_array('signature', $kinds, true)) {
            $counts['signatures'] = SignatureRequest::onlyTrashed()->limit(500)->forceDelete();
        }
        if (in_array('group', $kinds, true)) {
            $counts['groups'] = Group::onlyTrashed()->limit(500)->forceDelete();
        }
        if (in_array('calendar_event', $kinds, true)) {
            $counts['calendar_events'] = CalendarEvent::onlyTrashed()->limit(500)->forceDelete();
        }
        if (in_array('message_attachment', $kinds, true)) {
            $atts = MessageAttachment::onlyTrashed()->limit(500)->get();
            foreach ($atts as $att) {
                self::deleteAttachmentBytes($att);
            }
            $counts['message_attachments'] = $atts->count();
            MessageAttachment::onlyTrashed()->whereIn('id', $atts->pluck('id'))->forceDelete();
        }

        return $counts;
    }

    /** @return list<int> */
    private static function trashedFolderIds(): array
    {
        return Folder::onlyTrashed()->pluck('id')->all();
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function files(?string $search): Collection
    {
        $trashedFolders = self::trashedFolderIds();

        return FileItem::onlyTrashed()
            ->with(['owner:id,name', 'deletedBy:id,name'])
            ->where(fn ($q) => $q->whereNull('folder_id')->orWhereNotIn('folder_id', $trashedFolders ?: [0]))
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->whereRaw('LOWER(name) like ?', [$like]);
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (FileItem $f) => self::row(
                kind: 'file',
                id: $f->uuid,
                name: $f->name,
                subtitle: 'File'.($f->owner?->name ? ' · '.$f->owner->name : ''),
                deletedAt: $f->deleted_at,
                deletedBy: $f->deletedBy,
                meta: ['extension' => $f->extension, 'size' => (int) $f->size],
            ));
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function folders(?string $search): Collection
    {
        $trashedFolders = self::trashedFolderIds();

        return Folder::onlyTrashed()
            ->with(['owner:id,name', 'deletedBy:id,name'])
            ->where(fn ($q) => $q->whereNull('parent_id')->orWhereNotIn('parent_id', $trashedFolders ?: [0]))
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->whereRaw('LOWER(name) like ?', [$like]);
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (Folder $f) => self::row(
                kind: 'folder',
                id: $f->uuid,
                name: $f->name,
                subtitle: 'Folder'.($f->owner?->name ? ' · '.$f->owner->name : ''),
                deletedAt: $f->deleted_at,
                deletedBy: $f->deletedBy,
            ));
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function clients(?string $search): Collection
    {
        return Client::onlyTrashed()
            ->with(['creator:id,name'])
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->where(function ($w) use ($like) {
                    $w->whereRaw('LOWER(name) like ?', [$like])
                        ->orWhereRaw('LOWER(coalesce(company, \'\')) like ?', [$like])
                        ->orWhereRaw('LOWER(coalesce(email, \'\')) like ?', [$like]);
                });
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (Client $c) => self::row(
                kind: 'client',
                id: $c->uid,
                name: $c->name ?: 'Client',
                subtitle: 'Client'.($c->company ? ' · '.$c->company : ''),
                deletedAt: $c->deleted_at,
                deletedBy: $c->creator,
            ));
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function signatures(?string $search): Collection
    {
        return SignatureRequest::onlyTrashed()
            ->with(['creator:id,name'])
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->whereRaw('LOWER(title) like ?', [$like]);
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (SignatureRequest $s) => self::row(
                kind: 'signature',
                id: $s->uuid,
                name: $s->title ?: 'Signature request',
                subtitle: 'Signature',
                deletedAt: $s->deleted_at,
                deletedBy: $s->creator,
            ));
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function groups(?string $search): Collection
    {
        return Group::onlyTrashed()
            ->with(['creator:id,name'])
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->whereRaw('LOWER(name) like ?', [$like]);
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (Group $g) => self::row(
                kind: 'group',
                id: $g->uuid,
                name: $g->name,
                subtitle: 'Group',
                deletedAt: $g->deleted_at,
                deletedBy: $g->creator,
            ));
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function calendarEvents(?string $search): Collection
    {
        return CalendarEvent::onlyTrashed()
            ->with(['organizer:id,name'])
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->whereRaw('LOWER(title) like ?', [$like]);
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (CalendarEvent $e) => self::row(
                kind: 'calendar_event',
                id: $e->uuid,
                name: $e->title ?: 'Event',
                subtitle: 'Calendar',
                deletedAt: $e->deleted_at,
                deletedBy: $e->organizer,
            ));
    }

    /** @return Collection<int, array<string, mixed>> */
    private static function messageAttachments(?string $search): Collection
    {
        return MessageAttachment::onlyTrashed()
            ->with(['uploader:id,name'])
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->whereRaw('LOWER(name) like ?', [$like]);
            })
            ->orderByDesc('deleted_at')
            ->limit(self::PER_KIND)
            ->get()
            ->map(fn (MessageAttachment $a) => self::row(
                kind: 'message_attachment',
                id: $a->uuid,
                name: $a->name,
                subtitle: 'Message file',
                deletedAt: $a->deleted_at,
                deletedBy: $a->deletedBy ?: $a->uploader,
                meta: ['mime' => $a->mime, 'size' => (int) $a->size],
            ));
    }

    /** @param  array<string, mixed>  $meta */
    private static function row(
        string $kind,
        string $id,
        string $name,
        string $subtitle,
        mixed $deletedAt,
        ?User $deletedBy,
        array $meta = [],
    ): array {
        return [
            'id' => $id,
            'kind' => $kind,
            'name' => $name,
            'subtitle' => $subtitle,
            'deletedAt' => optional($deletedAt)?->toIso8601String(),
            'deletedBy' => $deletedBy ? [
                'id' => $deletedBy->id,
                'name' => $deletedBy->name,
            ] : null,
            'meta' => $meta,
            'canRestore' => true,
            'canPurge' => true,
        ];
    }

    private static function restoreFile(string $uuid): void
    {
        $file = FileItem::onlyTrashed()->where('uuid', $uuid)->firstOrFail();
        $file->restore();
    }

    private static function purgeFile(string $uuid): void
    {
        $file = FileItem::onlyTrashed()->where('uuid', $uuid)->firstOrFail();
        Vault::delete($file);
        $file->forceDelete();
    }

    private static function restoreFolder(string $uuid): void
    {
        $folder = Folder::onlyTrashed()->where('uuid', $uuid)->firstOrFail();
        FolderTree::restoreTree($folder);
    }

    private static function purgeFolder(string $uuid): void
    {
        $folder = Folder::onlyTrashed()->where('uuid', $uuid)->firstOrFail();
        FolderTree::purgeTree($folder);
    }

    private static function restoreClient(string $uid): void
    {
        Client::onlyTrashed()->where('uid', $uid)->firstOrFail()->restore();
    }

    private static function purgeClient(string $uid): void
    {
        Client::onlyTrashed()->where('uid', $uid)->firstOrFail()->forceDelete();
    }

    private static function restoreSignature(string $uuid): void
    {
        SignatureRequest::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->restore();
    }

    private static function purgeSignature(string $uuid): void
    {
        SignatureRequest::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->forceDelete();
    }

    private static function restoreGroup(string $uuid): void
    {
        Group::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->restore();
    }

    private static function purgeGroup(string $uuid): void
    {
        Group::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->forceDelete();
    }

    private static function restoreCalendarEvent(string $uuid): void
    {
        CalendarEvent::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->restore();
    }

    private static function purgeCalendarEvent(string $uuid): void
    {
        CalendarEvent::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->forceDelete();
    }

    private static function restoreMessageAttachment(string $uuid): void
    {
        MessageAttachment::onlyTrashed()->where('uuid', $uuid)->firstOrFail()->restore();
    }

    private static function purgeMessageAttachment(string $uuid): void
    {
        $att = MessageAttachment::onlyTrashed()->where('uuid', $uuid)->firstOrFail();
        self::deleteAttachmentBytes($att);
        $att->forceDelete();
    }

    private static function deleteAttachmentBytes(MessageAttachment $att): void
    {
        try {
            if ($att->path) {
                Storage::disk($att->disk)->delete($att->path);
            }
            if ($att->thumb_path) {
                Storage::disk($att->disk)->delete($att->thumb_path);
            }
        } catch (\Throwable) {
            // Bytes may already be gone; still remove the row.
        }
    }
}
