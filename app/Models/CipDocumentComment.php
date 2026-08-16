<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * The conversation about one document slot — "this scan is cut off at the
 * edge", and the reply that says a better one is coming.
 *
 * The shape is {@see FileComment}'s, deliberately: threading one level deep,
 * a `root_id` so a whole thread loads in one query, resolve rather than
 * delete, and a soft delete that keeps the row so replies beneath it do not
 * vanish. Reviewers move between the file library and an application all day
 * and should not have to learn a second comment panel.
 *
 * It hangs off the slot rather than the file because the slot outlives the
 * file. Emptying a slot must not take the review notes with it: the request
 * for a legible scan is exactly what has to still be there when the next one
 * arrives, and a slot that has never been filled has no file to comment on
 * at all.
 */
#[Fillable([
    'uuid', 'document_id', 'author_id', 'parent_id', 'root_id', 'body',
    'edited_at', 'resolved_at', 'resolved_by', 'deleted_by',
])]
class CipDocumentComment extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::creating(function (self $comment) {
            $comment->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'edited_at' => 'datetime',
            'resolved_at' => 'datetime',
            'deleted_at' => 'datetime',
            'replies_count' => 'integer',
        ];
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(CipDocument::class, 'document_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * Everything under this thread. Keyed on `root_id` rather than walked
     * through `parent_id`, so a reply to a reply is still one query away.
     */
    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'root_id')->whereNotNull('parent_id');
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
