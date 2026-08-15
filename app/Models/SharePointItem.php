<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'connection_id', 'graph_item_id', 'graph_parent_id', 'item_type', 'child_count', 'file_id', 'folder_id',
    'etag', 'ctag', 'web_url', 'name', 'size', 'mime_type',
    'graph_created_at', 'graph_modified_at', 'graph_modified_by',
    'sync_status', 'conflict_reason', 'last_error', 'failure_count', 'last_synced_at', 'recycled_at',
])]
class SharePointItem extends Model
{
    // Laravel would infer "share_point_…" from the class name.
    protected $table = 'sharepoint_items';

    public const SYNCED = 'synced';
    public const PENDING = 'pending';
    public const SYNCING = 'syncing';
    public const CONFLICT = 'conflict';
    public const FAILED = 'failed';

    protected function casts(): array
    {
        return [
            'graph_created_at' => 'datetime',
            'graph_modified_at' => 'datetime',
            'last_synced_at' => 'datetime',
            'recycled_at' => 'datetime',
            'size' => 'integer',
            'failure_count' => 'integer',
        ];
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(SharePointConnection::class, 'connection_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    /** The portal row is in the recycle bin, but the mapping is still here. */
    public function isRecycled(): bool
    {
        return $this->recycled_at !== null;
    }

    /**
     * The portal rows including recycled ones.
     *
     * `file` and `folder` hide anything soft-deleted, which is right for the
     * everyday paths — but the restore path exists precisely to reach a row
     * that IS in the bin, and there it must not come back null.
     */
    public function trashedFile(): ?FileItem
    {
        return $this->file_id ? FileItem::withTrashed()->find($this->file_id) : null;
    }

    public function trashedFolder(): ?Folder
    {
        return $this->folder_id ? Folder::withTrashed()->find($this->folder_id) : null;
    }
}
