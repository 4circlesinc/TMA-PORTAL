<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'root_id', 'last_read_comment_id'])]
class FileCommentRead extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function root(): BelongsTo
    {
        return $this->belongsTo(FileComment::class, 'root_id');
    }
}
