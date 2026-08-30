<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable([
    'uuid', 'file_id', 'author_id', 'company_member_id', 'author_name',
    'parent_id', 'root_id', 'body', 'anchor', 'edited_at', 'resolved_at',
    'resolved_by', 'deleted_by',
])]
class FileComment extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'anchor' => 'array',
            'edited_at' => 'datetime',
            'resolved_at' => 'datetime',
            'deleted_at' => 'datetime',
            'replies_count' => 'integer',
        ];
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id')->withTrashed();
    }

    public function companyMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'company_member_id');
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by')->withTrashed();
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'root_id')->whereNotNull('parent_id');
    }

    public function mentions(): HasMany
    {
        return $this->hasMany(FileCommentMention::class, 'comment_id');
    }

    public function isResolved(): bool
    {
        return $this->resolved_at !== null;
    }

    /** Top-level comments start a thread; replies hang off one. */
    public function isReply(): bool
    {
        return $this->parent_id !== null;
    }
}
