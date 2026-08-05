<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable([
    'application_id', 'user_id', 'author_name', 'author_email', 'body', 'source',
    'smartsheet_comment_remote_id', 'smartsheet_discussion_remote_id', 'commented_at',
])]
class CbiComment extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'commented_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CbiApplication::class, 'application_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
