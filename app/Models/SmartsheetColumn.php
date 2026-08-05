<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'sheet_id', 'remote_id', 'title', 'type', 'options', 'position', 'is_primary',
])]
class SmartsheetColumn extends Model
{
    protected function casts(): array
    {
        return [
            'options' => 'array',
            'position' => 'integer',
            'is_primary' => 'boolean',
        ];
    }

    public function sheet(): BelongsTo
    {
        return $this->belongsTo(SmartsheetSheet::class, 'sheet_id');
    }
}
