<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'uuid', 'tenant_id', 'site_id', 'site_name', 'site_url', 'drive_id', 'drive_name',
    'drive_kind', 'owner_upn', 'root_item_id', 'root_path',
    'folder_id', 'delta_link', 'status', 'sync_enabled', 'direction',
    'last_synced_at', 'last_success_at', 'last_error', 'error_count', 'created_by',
])]
class SharePointConnection extends Model
{
    // Laravel would infer "share_point_…" from the class name.
    protected $table = 'sharepoint_connections';

    /**
     * Database defaults, mirrored here so a freshly created instance already
     * has them. Without this `create()` returns a model whose `sync_enabled`
     * is null — and `! null` is true, so the very first sync silently
     * short-circuits as "disabled".
     */
    protected $attributes = [
        'status' => self::STATUS_IDLE,
        'sync_enabled' => true,
        'direction' => 'both',
        'error_count' => 0,
    ];

    public const STATUS_IDLE = 'idle';
    public const STATUS_SYNCING = 'syncing';
    public const STATUS_ERROR = 'error';
    public const STATUS_DISCONNECTED = 'disconnected';

    protected function casts(): array
    {
        return [
            'sync_enabled' => 'boolean',
            'last_synced_at' => 'datetime',
            'last_success_at' => 'datetime',
            'error_count' => 'integer',
        ];
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(SharePointItem::class, 'connection_id');
    }

    /** Portal changes are pushed back only when the link is two-way. */
    public function pushesBack(): bool
    {
        return $this->direction === 'both' && $this->sync_enabled;
    }
}
