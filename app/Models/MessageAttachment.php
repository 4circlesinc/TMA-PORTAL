<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable([
    'uuid', 'message_id', 'disk', 'path', 'name', 'mime', 'size',
    'width', 'height', 'duration_ms', 'thumb_path', 'waveform',
])]
class MessageAttachment extends Model
{
    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'duration_ms' => 'integer',
            'waveform' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (MessageAttachment $attachment) {
            $attachment->uuid ??= (string) Str::uuid();
        });
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
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

    /**
     * Which of the three shared-content tabs in the conversation info panel
     * this attachment belongs under.
     */
    public function shelf(): string
    {
        return $this->isImage() || $this->isVideo() ? 'media' : 'documents';
    }
}
