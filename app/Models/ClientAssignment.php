<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A staff member assigned to a client, at a permission level. FileAccess reads
 * `permission_level` to decide what the staff member may do inside the client's
 * folder, so this row is the single source of truth for that access.
 */
#[Fillable(['client_id', 'user_id', 'permission_level', 'is_primary', 'assigned_by'])]
class ClientAssignment extends Model
{
    /**
     * Permission levels, lowest to highest, mapped to the File Library roles
     * FileAccess already understands (viewer/downloader/editor/full).
     */
    public const LEVELS = [
        'view_only' => 'viewer',
        'view_files' => 'viewer',
        'contributor' => 'downloader',
        'editor' => 'editor',
        'manager' => 'editor',
        'full' => 'full',
    ];

    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
        ];
    }

    /** The File Library role this assignment's level grants over the folder. */
    public function fileRole(): string
    {
        return self::LEVELS[$this->permission_level] ?? 'viewer';
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
