<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'application_id', 'type', 'field', 'from_value', 'to_value',
    'source', 'actor_name', 'actor_user_id', 'meta', 'occurred_at',
])]
class CbiApplicationEvent extends Model
{
    public const TYPE_IMPORTED = 'imported';
    public const TYPE_STAGE_CHANGED = 'stage_changed';
    public const TYPE_STATUS_CHANGED = 'status_changed';
    public const TYPE_FIELD_CHANGED = 'field_changed';
    public const TYPE_COMMENT_ADDED = 'comment_added';
    public const TYPE_ASSIGNED = 'assigned';

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'occurred_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CbiApplication::class, 'application_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
