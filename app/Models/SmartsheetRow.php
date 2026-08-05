<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'sheet_id', 'remote_id', 'row_number', 'parent_remote_id', 'cells',
    'permalink', 'created_at_remote', 'modified_at_remote', 'synced_at',
])]
class SmartsheetRow extends Model
{
    protected function casts(): array
    {
        return [
            'cells' => 'array',
            'row_number' => 'integer',
            'created_at_remote' => 'datetime',
            'modified_at_remote' => 'datetime',
            'synced_at' => 'datetime',
        ];
    }

    public function sheet(): BelongsTo
    {
        return $this->belongsTo(SmartsheetSheet::class, 'sheet_id');
    }
}
