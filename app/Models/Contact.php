<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * An address-book entry: someone you write to or share with who has no portal
 * account. The Shared book is account-wide; a Personal book belongs to exactly
 * one person and is never visible to anyone else — see {@see self::visibleTo()},
 * which is the only place that rule is expressed.
 */
#[Fillable([
    'uuid', 'scope', 'owner_id', 'first_name', 'last_name', 'email',
    'company', 'phone', 'job_title', 'notes', 'created_by',
])]
class Contact extends Model
{
    use SoftDeletes;

    public const SCOPE_SHARED = 'shared';

    public const SCOPE_PERSONAL = 'personal';

    public const SCOPES = [self::SCOPE_SHARED, self::SCOPE_PERSONAL];

    protected function casts(): array
    {
        return [
            'deleted_at' => 'datetime',
        ];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The entries this person may read in a book. A personal book is scoped to
     * its owner even for administrators — it is private by definition.
     */
    public function scopeVisibleTo(Builder $query, User $user, string $scope): Builder
    {
        return $scope === self::SCOPE_SHARED
            ? $query->where('scope', self::SCOPE_SHARED)
            : $query->where('scope', self::SCOPE_PERSONAL)->where('owner_id', $user->id);
    }

    public function displayName(): string
    {
        return trim($this->first_name.' '.(string) $this->last_name);
    }

    /** @return array<string, mixed> */
    public function toRecord(): array
    {
        return [
            'id' => $this->uuid,
            'scope' => $this->scope,
            'firstName' => $this->first_name,
            'lastName' => $this->last_name,
            'name' => $this->displayName(),
            'email' => $this->email,
            'company' => $this->company,
            'phone' => $this->phone,
            'jobTitle' => $this->job_title,
            'notes' => $this->notes,
            'addedIso' => $this->created_at?->toIso8601String(),
        ];
    }
}
