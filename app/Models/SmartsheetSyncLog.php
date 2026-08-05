<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'sheet_id', 'run_id', 'action', 'level', 'detail', 'meta', 'created_at',
])]
class SmartsheetSyncLog extends Model
{
    // Log rows are append-only; created_at is set explicitly by the writer.
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
