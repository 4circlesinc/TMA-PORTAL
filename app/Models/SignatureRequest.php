<?php

namespace App\Models;

use App\Support\Signatures\Status;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A request to have one document signed by one or more recipients.
 *
 * The original file and the signed copy are deliberately separate rows in
 * `files` - completing a request never overwrites what was sent out.
 */
#[Fillable([
    'uuid', 'file_id', 'signed_file_id', 'folder_id', 'created_by', 'title',
    'subject', 'message', 'status', 'auto_delete_days', 'expires_at', 'sent_at',
    'completed_at', 'declined_at', 'cancelled_at',
])]
class SignatureRequest extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'auto_delete_days' => 'integer',
            'expires_at' => 'datetime',
            'sent_at' => 'datetime',
            'completed_at' => 'datetime',
            'declined_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }

    public function signedFile(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'signed_file_id');
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function recipients(): HasMany
    {
        return $this->hasMany(SignatureRecipient::class)->orderBy('signing_order');
    }

    public function fields(): HasMany
    {
        return $this->hasMany(SignatureField::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(SignatureEvent::class)->latest('created_at');
    }

    /** Still open for recipient action. */
    public function isPending(): bool
    {
        return in_array($this->status, Status::PENDING, true);
    }

    /** Reached a terminal state - never mutate the document again. */
    public function isFinal(): bool
    {
        return in_array($this->status, Status::FINAL, true);
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }
}
