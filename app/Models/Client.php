<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A contact in the firm's client directory (the "Client hub").
 *
 * The full, irregular contact record lives in `data`; the scalar columns are
 * denormalised copies kept for listing and search. `toRecord()` is the single
 * shape the clients UI consumes.
 */
#[Fillable(['uid', 'user_id', 'folder_id', 'name', 'company', 'email', 'phone', 'initial', 'initial_color', 'data', 'created_by'])]
class Client extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'data' => 'array',
            'deleted_at' => 'datetime',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** The portal login account this client signs in with (if linked). */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** The client's permanent main folder in the File Library. */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(ClientAssignment::class);
    }

    /**
     * The record shape the clients page expects: a directory entry (id, name,
     * avatar fallback) with the full profile nested under `profile`.
     *
     * @return array<string, mixed>
     */
    public function toRecord(): array
    {
        return [
            'id' => $this->uid,
            'name' => $this->name,
            'initial' => $this->initial,
            'initialColor' => $this->initial_color,
            'profile' => $this->data ?? [],
            'folderUuid' => $this->folder?->uuid,
            'hasLogin' => $this->user_id !== null,
        ];
    }
}
