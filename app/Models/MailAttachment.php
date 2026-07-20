<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Attachment metadata; the bytes stream from the provider on download. */
#[Fillable([
    'uuid', 'mail_message_id', 'remote_id', 'filename', 'mime_type', 'size',
    'is_inline', 'content_id',
])]
#[Hidden(['remote_id'])]
class MailAttachment extends Model
{
    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'is_inline' => 'boolean',
        ];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(MailMessage::class, 'mail_message_id');
    }

    public function toRecord(): array
    {
        return [
            'id' => $this->uuid,
            'name' => $this->filename,
            'mime' => $this->mime_type,
            'size' => $this->size,
        ];
    }
}
