<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per thing that happened to an application — append-only, written
 * in the same transaction as the change it records. This is the durable
 * compliance audit: unlike activity_logs it is never pruned, never updated,
 * never deleted. actor_id null means the system acted (a scheduled job).
 */
#[Fillable([
    'application_id', 'actor_id', 'action', 'from_status', 'to_status',
    'detail', 'meta', 'ip_address',
])]
class CipEvent extends Model
{
    public const UPDATED_AT = null;

    public const ACTION_CREATED = 'created';

    public const ACTION_STATUS_CHANGED = 'status_changed';

    public const ACTION_ASSIGNED = 'assigned';

    public const ACTION_UNASSIGNED = 'unassigned';

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
