<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A staff member assigned to a whole company.
 *
 * Deliberately the same shape as ClientAssignment — same roles, same levels,
 * same "ends rather than deletes" rule — because it answers the same question
 * one level up. The difference is `applies_to_clients`, which decides whether
 * the assignment reaches the contacts underneath the company as well.
 */
#[Fillable([
    'company_id', 'user_id', 'role', 'permission_level', 'is_primary',
    'applies_to_clients', 'status', 'starts_at', 'ends_at', 'ended_at',
    'ended_by', 'notes', 'assigned_by',
])]
class CompanyStaffAssignment extends Model
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_ENDED = 'ended';

    /** How far the assignment reaches beyond the company record itself. */
    public const SCOPE_COMPANY_ONLY = 'company_only';

    public const SCOPE_EXISTING = 'existing';

    public const SCOPE_EXISTING_FUTURE = 'existing_future';

    public const SCOPES = [
        self::SCOPE_COMPANY_ONLY => 'The company only',
        self::SCOPE_EXISTING => 'The company and its current contacts',
        self::SCOPE_EXISTING_FUTURE => 'The company and all its contacts, now and in future',
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

    public function scopeLive(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_ACTIVE)
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', now()))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()));
    }

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

    /** Does this assignment reach the clients under the company? */
    public function reachesClients(): bool
    {
        return $this->applies_to_clients !== self::SCOPE_COMPANY_ONLY;
    }

    /** …including ones added after the assignment was made? */
    public function reachesFutureClients(): bool
    {
        return $this->applies_to_clients === self::SCOPE_EXISTING_FUTURE;
    }

    public function fileRole(): ?string
    {
        if (! $this->isLive()) {
            return null;
        }

        return ClientAssignment::LEVELS[$this->permission_level] ?? 'viewer';
    }

    public function roleLabel(): string
    {
        return ClientAssignment::ROLES[$this->role] ?? ClientAssignment::ROLES['general'];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assigner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    /** @return array<string, mixed> */
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
            'appliesToClients' => $this->applies_to_clients,
            'appliesLabel' => self::SCOPES[$this->applies_to_clients] ?? '',
            'status' => $this->status,
            'live' => $this->isLive(),
            'notes' => $this->notes,
            'assignedBy' => $this->assigner?->name,
            'endsAt' => $this->ends_at?->toIso8601String(),
            'endedAt' => $this->ended_at?->toIso8601String(),
        ];
    }
}
