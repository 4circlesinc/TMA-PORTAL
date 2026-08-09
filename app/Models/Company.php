<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A firm client company. Contact persons live on `clients` and point here via
 * `company_id`.
 */
#[Fillable([
    'uid', 'name', 'logo_url', 'company_type', 'registration_number', 'tax_number',
    'industry', 'website', 'email', 'phone', 'address', 'billing', 'status',
    'notes', 'created_by',
])]
class Company extends Model
{
    use SoftDeletes;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_PROSPECT = 'prospect';

    public const STATUS_ARCHIVED = 'archived';

    /** The legal shapes a client company can take. */
    public const TYPES = [
        'limited_company' => 'Limited company',
        'partnership' => 'Partnership',
        'sole_trader' => 'Sole trader',
        'non_profit' => 'Non-profit',
        'government' => 'Government',
        'other' => 'Other',
    ];

    protected function casts(): array
    {
        return [
            'address' => 'array',
            'billing' => 'array',
            'deleted_at' => 'datetime',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function clients(): HasMany
    {
        return $this->hasMany(Client::class);
    }

    /**
     * Clients this company sent to the firm. Distinct from `clients()`, which
     * is the people who belong to it — a referral confers no membership.
     */
    public function referredClients(): HasMany
    {
        return $this->hasMany(Client::class, 'referred_by_company_id');
    }

    /** Everyone at the company who has (or is being given) portal access. */
    public function members(): HasMany
    {
        return $this->hasMany(CompanyMember::class);
    }

    /** The firm's own people looking after this company. */
    public function staffAssignments(): HasMany
    {
        return $this->hasMany(CompanyStaffAssignment::class);
    }

    public function isArchived(): bool
    {
        return $this->status === self::STATUS_ARCHIVED;
    }

    public function typeLabel(): ?string
    {
        return $this->company_type ? (self::TYPES[$this->company_type] ?? $this->company_type) : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function toRecord(): array
    {
        $people = $this->relationLoaded('clients')
            ? $this->clients
            : $this->clients()->orderBy('name')->get();

        return [
            'id' => $this->uid,
            'name' => $this->name,
            'logoUrl' => $this->logo_url,
            'companyType' => $this->company_type,
            'companyTypeLabel' => $this->typeLabel(),
            'registrationNumber' => $this->registration_number,
            'taxNumber' => $this->tax_number,
            'industry' => $this->industry,
            'website' => $this->website,
            'email' => $this->email,
            'phone' => $this->phone,
            'address' => $this->address,
            'billing' => $this->billing,
            'status' => $this->status,
            'notes' => $this->notes,
            'memberCount' => $this->members()->current()->count(),
            'peopleCount' => $people->count(),
            // withCount() when the list loaded it, a query when a single
            // company was fetched on its own.
            'referredCount' => $this->referred_clients_count ?? $this->referredClients()->count(),
            'people' => $people->map(fn (Client $c) => [
                'id' => $c->uid,
                'name' => $c->name,
                'initial' => $c->initial,
                'initialColor' => $c->initial_color,
                'email' => $c->email,
                'hasLogin' => $c->user_id !== null,
            ])->values()->all(),
        ];
    }
}
