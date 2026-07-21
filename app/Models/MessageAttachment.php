<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable([
    'uuid', 'message_id', 'conversation_id', 'uploaded_by', 'disk', 'path',
    'name', 'mime', 'extension', 'status', 'is_voice', 'size',
    'width', 'height', 'duration_ms', 'thumb_path', 'waveform',
])]
class MessageAttachment extends Model
{
    /** Uploaded and previewable, but not yet attached to a sent message. */
    public const STATUS_STAGED = 'staged';

    /** Attached to a message that was sent. */
    public const STATUS_READY = 'ready';

    protected function casts(): array
    {
        return [
            'is_voice' => 'boolean',
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'duration_ms' => 'integer',
            'waveform' => 'array',
        ];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
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
        // MediaRecorder emits an audio-only WebM, which sniffs as video/webm.
        // A voice note is never a video however it is packaged.
        if ($this->isVoice()) {
            return false;
        }

        return str_starts_with((string) $this->mime, 'video/');
    }

    public function isAudio(): bool
    {
        return str_starts_with((string) $this->mime, 'audio/');
    }

    /** A recorded voice note, as opposed to an attached audio file. */
    public function isVoice(): bool
    {
        return (bool) $this->is_voice;
    }

    /**
     * Which of the three shared-content tabs in the conversation info panel
     * this attachment belongs under.
     */
    public function shelf(): string
    {
        // Voice notes are neither media to browse nor documents to file; they
        // belong to their conversation, not to a gallery shelf.
        if ($this->isVoice()) {
            return 'voice';
        }

        return $this->isImage() || $this->isVideo() ? 'media' : 'documents';
    }
}
