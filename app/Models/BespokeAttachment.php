<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable([
    'uuid', 'user_id', 'conversation_id', 'message_id', 'kind', 'name', 'mime', 'extension',
    'size', 'disk', 'path', 'encrypted', 'checksum', 'width', 'height', 'pages', 'text',
])]
class BespokeAttachment extends Model
{
    public const KIND_UPLOAD = 'upload';

    /** Made by the portal from another attachment, such as a 2×2 photo. */
    public const KIND_DERIVED = 'derived';

    protected static function booted(): void
    {
        static::creating(function (self $attachment) {
            $attachment->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'encrypted' => 'boolean',
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'pages' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(BespokeConversation::class, 'conversation_id');
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(BespokeMessage::class, 'message_id');
    }

    public function isImage(): bool
    {
        return str_starts_with((string) $this->mime, 'image/');
    }

    public function isPdf(): bool
    {
        return $this->mime === 'application/pdf' || $this->extension === 'pdf';
    }

    public function hasText(): bool
    {
        return is_string($this->text) && trim($this->text) !== '';
    }
}
