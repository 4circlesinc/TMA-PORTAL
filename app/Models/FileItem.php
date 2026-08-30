<?php

namespace App\Models;

use App\Support\Companies\ContactIdentity;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A stored file. Named FileItem (table `files`) to avoid colliding with the
 * Illuminate\Support\Facades\File facade in controllers/services.
 *
 * `storage_path` and `disk` are private — never serialize them to the client.
 */
#[Fillable([
    'uuid', 'folder_id', 'name', 'extension', 'mime_type', 'size', 'disk',
    'storage_path', 'checksum', 'content_state', 'version_number', 'origin', 'owner_id', 'uploaded_by',
    'uploaded_by_member_id',
    'source_modified_at', 'deleted_by',
    'review_status', 'review_note', 'reviewed_by', 'reviewed_at',
])]
#[Hidden(['storage_path', 'disk'])]
class FileItem extends Model
{
    use SoftDeletes;

    protected $table = 'files';

    protected static function booted(): void
    {
        static::creating(function (self $file) {
            if ($file->uploaded_by_member_id || ! $file->uploaded_by) {
                return;
            }

            $file->uploaded_by_member_id = ContactIdentity::forUserId(
                $file->uploaded_by,
                ContactIdentity::companyIdForFolder($file->folder_id),
            )?->id;
        });
    }

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'source_modified_at' => 'datetime',
            'deleted_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
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
        return $this->belongsTo(User::class, 'uploaded_by')->withTrashed();
    }

    public function uploadedByMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'uploaded_by_member_id');
    }

    public function deletedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'deleted_by');
    }

    /**
     * The CIP checklist slot this file answers, when it is one.
     *
     * Most library files are not slots. The ones that are must show the
     * slot's status in the File Library, not a second review vocabulary.
     */
    public function cipDocument(): HasOne
    {
        return $this->hasOne(CipDocument::class, 'file_id');
    }
}
