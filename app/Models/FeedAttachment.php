<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A file attached to a post or a comment. Bytes live in the File Library's
 * vault; this row records where, and is never handed a public URL.
 */
#[Fillable([
    'uuid', 'post_id', 'comment_id', 'channel_id', 'uploaded_by',
    'disk', 'path', 'name', 'mime', 'extension', 'size',
    'width', 'height', 'duration_ms', 'thumb_path', 'status',
])]
class FeedAttachment extends Model
{
    use SoftDeletes;

    /** Uploaded, not yet claimed by a post or comment. */
    public const STATUS_STAGED = 'staged';

    /** Claimed. */
    public const STATUS_READY = 'ready';

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'deleted_at' => 'datetime',
        ];
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(FeedPost::class, 'post_id');
    }

    public function comment(): BelongsTo
    {
        return $this->belongsTo(FeedComment::class, 'comment_id');
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(FeedChannel::class, 'channel_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function isImage(): bool
    {
        return str_starts_with((string) $this->mime, 'image/');
    }

    public function isVideo(): bool
    {
        return str_starts_with((string) $this->mime, 'video/');
    }

    public function isAudio(): bool
    {
        return str_starts_with((string) $this->mime, 'audio/');
    }
}
