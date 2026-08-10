<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A request for documents, collected through a secure upload link.
 *
 * Write-only by design: the visitor can add files to one destination and can
 * see nothing else — not the folder's contents, not the workspace, not even
 * the files they themselves uploaded a session ago.
 */
#[Fillable([
    'uuid', 'token', 'title', 'message', 'folder_id', 'client_id', 'created_by',
    'recipient_email', 'recipient_name', 'allowed_extensions', 'max_bytes',
    'max_files', 'allow_multiple', 'password_hash', 'expires_at', 'closed_at',
    'revoked_at', 'opened_at',
])]
#[Hidden(['password_hash', 'token'])]
class FileRequest extends Model
{
    protected function casts(): array
    {
        return [
            'allowed_extensions' => 'array',
            'allow_multiple' => 'boolean',
            'expires_at' => 'datetime',
            'closed_at' => 'datetime',
            'revoked_at' => 'datetime',
            'opened_at' => 'datetime',
            'last_upload_at' => 'datetime',
        ];
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function uploads(): HasMany
    {
        return $this->hasMany(FileRequestUpload::class);
    }

    /** Revoked, closed by hand, or past its date — three ways to be shut. */
    public function isOpen(): bool
    {
        if ($this->revoked_at !== null || $this->closed_at !== null) {
            return false;
        }

        return $this->expires_at === null || $this->expires_at->isFuture();
    }

    /** Why it is shut, for the page the visitor lands on. */
    public function closedReason(): ?string
    {
        if ($this->revoked_at !== null) {
            return 'revoked';
        }

        if ($this->closed_at !== null) {
            return 'closed';
        }

        if ($this->expires_at !== null && $this->expires_at->isPast()) {
            return 'expired';
        }

        return null;
    }

    public function isFull(): bool
    {
        return $this->max_files > 0 && $this->upload_count >= $this->max_files;
    }

    /** How many more files this link will still take. */
    public function remainingUploads(): int
    {
        if ($this->max_files <= 0) {
            return PHP_INT_MAX;
        }

        return max(0, $this->max_files - (int) $this->upload_count);
    }
}
