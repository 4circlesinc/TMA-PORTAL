<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'sheet_id', 'remote_id', 'parent_type', 'parent_remote_id', 'name',
    'mime_type', 'attachment_type', 'size_kb', 'created_by', 'created_at_remote', 'file_id',
])]
class SmartsheetAttachment extends Model
{
    protected function casts(): array
    {
        return [
            'size_kb' => 'integer',
            'created_at_remote' => 'datetime',
        ];
    }

    public function sheet(): BelongsTo
    {
        return $this->belongsTo(SmartsheetSheet::class, 'sheet_id');
    }

    /**
     * The File Library copy, once the document has been mirrored across by
     * App\Support\Cbi\DocumentImporter. Null means the bytes are still only
     * in Smartsheet, behind a link that expires in minutes.
     */
    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }
}
