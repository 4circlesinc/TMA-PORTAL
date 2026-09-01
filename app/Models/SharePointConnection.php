<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'uuid', 'tenant_id', 'site_id', 'site_name', 'site_url', 'drive_id', 'drive_name',
    'drive_kind', 'owner_upn', 'root_item_id', 'root_path', 'root_child_count',
    'folder_id', 'delta_link', 'status', 'sync_enabled', 'paused_at', 'direction',
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

    /**
     * A run that stops heartbeating is dead — even if the row still says
     * `syncing` because the worker was killed mid-pass.
     */
    public const HEARTBEAT_STALE_MINUTES = 5;

    protected function casts(): array
    {
        return [
            'sync_enabled' => 'boolean',
            'paused_at' => 'datetime',
            'last_synced_at' => 'datetime',
            'last_success_at' => 'datetime',
            'error_count' => 'integer',
        ];
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    /**
     * This user's own OneDrive link, if they connected one.
     *
     * Matched on `created_by` OR the Microsoft account's email against
     * `owner_upn`: the row is created by a queued job, so created_by is the
     * owner for OAuth-provisioned drives, while command-connected drives are
     * only recognisable by UPN. Same lookup the sync-status toasts use.
     */
    public static function personalDriveFor(User $user): ?self
    {
        $email = $user->connectedAccount('microsoft')?->email;

        return static::query()
            ->where('drive_kind', 'onedrive')
            ->where(function ($q) use ($user, $email) {
                $q->where('created_by', $user->id);
                if ($email) {
                    $q->orWhere('owner_upn', $email);
                }
            })
            ->orderBy('id')
            ->first();
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

    /**
     * What the UI should read — `syncing` only while the run is still alive.
     *
     * Queue timeouts and worker restarts leave `status = syncing` with nothing
     * behind it; without this the progress toast sits at "155,259 of 155,259"
     * for the full 30-minute lock window even though the job died in a minute.
     */
    public function effectiveStatus(): string
    {
        if ($this->status !== self::STATUS_SYNCING) {
            return $this->status;
        }

        if ($this->last_synced_at === null
            || $this->last_synced_at->lte(now()->subMinutes(self::HEARTBEAT_STALE_MINUTES))) {
            return self::STATUS_IDLE;
        }

        return self::STATUS_SYNCING;
    }
}
