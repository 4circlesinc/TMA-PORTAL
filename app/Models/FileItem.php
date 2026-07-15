<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A stored file. Named FileItem (table `files`) to avoid colliding with the
 * Illuminate\Support\Facades\File facade in controllers/services.
 *
 * `storage_path` and `disk` are private — never serialize them to the client.
 */
#[Fillable([
    'uuid', 'folder_id', 'name', 'extension', 'mime_type', 'size', 'disk',
    'storage_path', 'checksum', 'owner_id', 'uploaded_by', 'source_modified_at', 'deleted_by',
])]
#[Hidden(['storage_path', 'disk'])]
class FileItem extends Model
{
    use SoftDeletes;

    protected $table = 'files';

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'source_modified_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
