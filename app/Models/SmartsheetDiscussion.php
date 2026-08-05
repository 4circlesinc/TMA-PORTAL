<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'sheet_id', 'remote_id', 'parent_type', 'parent_remote_id', 'title',
    'comment_count', 'created_by', 'last_commented_at',
])]
class SmartsheetDiscussion extends Model
{
    protected function casts(): array
    {
        return [
            'comment_count' => 'integer',
            'last_commented_at' => 'datetime',
        ];
    }

    public function sheet(): BelongsTo
    {
        return $this->belongsTo(SmartsheetSheet::class, 'sheet_id');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(SmartsheetComment::class, 'discussion_id');
    }
}
