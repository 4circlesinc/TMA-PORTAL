<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'uuid', 'token', 'item_type', 'item_id', 'shared_by', 'kind', 'target_user_id',
    'target_email', 'role', 'capabilities', 'allow_download', 'password_hash',
    'expires_at', 'revoked_at',
])]
#[Hidden(['password_hash'])]
class Share extends Model
{
    protected function casts(): array
    {
        return [
            'capabilities' => 'array',
            'allow_download' => 'boolean',
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function sharedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'shared_by');
    }

    public function targetUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'target_user_id');
    }

    /** A share is usable only if it hasn't been revoked or expired. */
    public function isActive(): bool
    {
        if ($this->revoked_at !== null) {
            return false;
        }

        return $this->expires_at === null || $this->expires_at->isFuture();
    }
}
