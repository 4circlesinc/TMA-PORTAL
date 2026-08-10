<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One file that arrived through a request link. */
#[Fillable([
    'file_request_id', 'file_id', 'name', 'size',
    'uploader_name', 'uploader_email', 'ip',
])]
class FileRequestUpload extends Model
{
    public function request(): BelongsTo
    {
        return $this->belongsTo(FileRequest::class, 'file_request_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }
}
