<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'uuid', 'user_id', 'folder_id', 'filename', 'size', 'mime_declared', 'chunk_size',
    'total_chunks', 'received_count', 'checksum', 'status', 'temp_path', 'conflict', 'expires_at',
])]
class UploadSession extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_UPLOADING = 'uploading';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';
    public const STATUS_CANCELLED = 'cancelled';

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'chunk_size' => 'integer',
            'total_chunks' => 'integer',
            'received_count' => 'integer',
            'expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }
}
