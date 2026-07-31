<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One stored revision of a file. `storage_path`/`disk` are private — they are
 * never serialized to the client, exactly as on FileItem.
 */
#[Fillable([
    'uuid', 'file_id', 'version_number', 'disk', 'storage_path', 'size', 'checksum',
    'mime_type', 'extension', 'uploaded_by', 'note', 'restored_from_id', 'is_current',
    'approval_status', 'graph_version_id',
])]
#[Hidden(['storage_path', 'disk'])]
class FileVersion extends Model
{
    protected function casts(): array
    {
        return [
            'version_number' => 'integer',
            'size' => 'integer',
            'is_current' => 'boolean',
        ];
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function restoredFrom(): BelongsTo
    {
        return $this->belongsTo(self::class, 'restored_from_id');
    }
}
