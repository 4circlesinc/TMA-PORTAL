<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'discussion_id', 'sheet_id', 'remote_id', 'text',
    'created_by_name', 'created_by_email', 'created_at_remote', 'modified_at_remote',
])]
class SmartsheetComment extends Model
{
    protected function casts(): array
    {
        return [
            'created_at_remote' => 'datetime',
            'modified_at_remote' => 'datetime',
        ];
    }

    public function discussion(): BelongsTo
    {
        return $this->belongsTo(SmartsheetDiscussion::class, 'discussion_id');
    }
}
