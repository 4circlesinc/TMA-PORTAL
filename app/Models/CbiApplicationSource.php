<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'application_id', 'sheet_remote_id', 'row_remote_id', 'sheet_name',
    'sheet_category', 'row_modified_at', 'last_seen_at',
])]
class CbiApplicationSource extends Model
{
    protected function casts(): array
    {
        return [
            'row_modified_at' => 'datetime',
            'last_seen_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CbiApplication::class, 'application_id');
    }
}
