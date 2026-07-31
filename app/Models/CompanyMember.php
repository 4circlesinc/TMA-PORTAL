<?php

namespace App\Models;

use App\Support\Companies\CompanyRoles;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One person's membership of a company account.
 *
 * A member can exist before they have a login: `user_id` stays null until they
 * accept their invitation, which is what lets a company be set up in full and
 * its people invited afterwards. Everything that grants access therefore has to
 * check {@see self::isActive()} *and* that there is a user behind it.
 */
#[Fillable([
    'uuid', 'company_id', 'user_id', 'client_id', 'name', 'email', 'job_title',
    'role', 'is_primary', 'status', 'added_by', 'removed_at', 'removed_by',
    ...CompanyRoles::ABILITIES,
])]
class CompanyMember extends Model
{
    public const STATUS_INVITED = 'invited';

    public const STATUS_ACTIVE = 'active';

    public const STATUS_REMOVED = 'removed';

    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'removed_at' => 'datetime',
            'can_view_bookings' => 'boolean',
            'can_manage_bookings' => 'boolean',
            'can_view_files' => 'boolean',
            'can_upload_files' => 'boolean',
            'can_view_invoices' => 'boolean',
            'can_view_contracts' => 'boolean',
            'can_sign_contracts' => 'boolean',
            'can_invite_others' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (CompanyMember $member) {
            $member->uuid ??= (string) Str::uuid();
        });
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    /** Members who have not been removed — invited ones included. */
    public function scopeCurrent(Builder $query): Builder
    {
        return $query->where('status', '!=', self::STATUS_REMOVED);
    }

    /** Members who can actually sign in and use their access right now. */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_ACTIVE)->whereNotNull('user_id');
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE && $this->user_id !== null;
    }

    public function isRemoved(): bool
    {
        return $this->status === self::STATUS_REMOVED;
    }

    /** Does this member hold the ability? Removed members hold nothing. */
    public function can(string $ability): bool
    {
        if (! $this->isActive()) {
            return false;
        }

        return in_array($ability, CompanyRoles::ABILITIES, true)
            && (bool) $this->{$ability};
    }

    public function roleLabel(): string
    {
        return CompanyRoles::label($this->role);
    }

    /** The display name, whether or not they have an account yet. */
    public function displayName(): string
    {
        return $this->user?->name ?: ($this->name ?: ($this->email ?: 'Company member'));
    }

    public function displayEmail(): ?string
    {
        return $this->user?->email ?: $this->email;
    }

    /** @return array<string, mixed> */
    public function toRecord(): array
    {
        $abilities = [];
        foreach (CompanyRoles::ABILITIES as $ability) {
            $abilities[Str::camel($ability)] = (bool) $this->{$ability};
        }

        return [
            'id' => $this->uuid,
            'name' => $this->displayName(),
            'email' => $this->displayEmail(),
            'jobTitle' => $this->job_title,
            'role' => $this->role,
            'roleLabel' => $this->roleLabel(),
            'primary' => $this->is_primary,
            'status' => $this->status,
            'hasAccount' => $this->user_id !== null,
            'avatar' => $this->user?->photoUrl(),
            'clientUid' => $this->client?->uid,
            'abilities' => $abilities,
            'addedAt' => $this->created_at?->toIso8601String(),
            'removedAt' => $this->removed_at?->toIso8601String(),
        ];
    }
}
