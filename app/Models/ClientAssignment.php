<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A staff member assigned to a client — what they do for them (`role`) and what
 * they may reach (`permission_level`).
 *
 * FileAccess reads this row to decide what the staff member may do inside the
 * client's folder, so it is the single source of truth for that access. Two
 * things follow from that, and both matter:
 *
 *  - Ending an assignment must take the access with it. That is why access is
 *    gated on {@see self::isLive()} rather than on the row existing.
 *  - An assignment can lapse on its own, when `ends_at` passes. Nothing has to
 *    run for that to take effect — a cover arrangement simply stops working the
 *    moment it is over, with no scheduled job to forget to set up.
 */
#[Fillable([
    'client_id', 'user_id', 'role', 'permission_level', 'is_primary', 'status',
    'assigned_by', 'starts_at', 'ends_at', 'ended_at', 'ended_by', 'notes',
])]
class ClientAssignment extends Model
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_ENDED = 'ended';

    /**
     * What this person does for the client. Distinct from permission_level:
     * the role says which conversation to include them in, the level says what
     * they may open.
     */
    public const ROLES = [
        'account_manager' => 'Account manager',
        'booking_coordinator' => 'Booking coordinator',
        'finance' => 'Finance contact',
        'contract_manager' => 'Contract manager',
        'event_coordinator' => 'Event coordinator',
        'general' => 'Assigned staff',
    ];

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
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    /** Assignments that still count — not ended, not lapsed, already started. */
    public function scopeLive(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_ACTIVE)
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', now()))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()));
    }

    /** The same test as {@see self::scopeLive()}, for a loaded row. */
    public function isLive(): bool
    {
        if ($this->status !== self::STATUS_ACTIVE) {
            return false;
        }

        if ($this->starts_at !== null && $this->starts_at->isFuture()) {
            return false;
        }

        return $this->ends_at === null || $this->ends_at->isFuture();
    }

    /** Ended by someone, as opposed to having quietly lapsed. */
    public function wasEnded(): bool
    {
        return $this->status === self::STATUS_ENDED;
    }

    public function roleLabel(): string
    {
        return self::ROLES[$this->role] ?? self::ROLES['general'];
    }

    /**
     * The File Library role this assignment grants over the folder — nothing
     * at all once it is no longer live.
     */
    public function fileRole(): ?string
    {
        if (! $this->isLive()) {
            return null;
        }

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

    public function assigner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    /** The shape the clients UI renders for one assignment. */
    public function toRecord(): array
    {
        return [
            'userId' => $this->user_id,
            'name' => $this->user?->name,
            'email' => $this->user?->email,
            'avatar' => $this->user?->photoUrl(),
            'role' => $this->role,
            'roleLabel' => $this->roleLabel(),
            'level' => $this->permission_level,
            'primary' => $this->is_primary,
            'status' => $this->status,
            'live' => $this->isLive(),
            'notes' => $this->notes,
            'assignedBy' => $this->assigner?->name,
            'assignedAt' => $this->created_at?->toIso8601String(),
            'startsAt' => $this->starts_at?->toIso8601String(),
            'endsAt' => $this->ends_at?->toIso8601String(),
            'endedAt' => $this->ended_at?->toIso8601String(),
        ];
    }
}
