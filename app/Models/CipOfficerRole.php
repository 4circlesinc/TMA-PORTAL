<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A per-user CIP officer grant. Account types stay Client/Employee/
 * Administrator; being a CRO / Reviewing Officer or a Compliance Officer is
 * this row, read through App\Support\Cip\CipAccess — never checked directly.
 */
#[Fillable(['user_id', 'role', 'granted_by'])]
class CipOfficerRole extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function grantor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'granted_by');
    }
}
