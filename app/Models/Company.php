<?php

namespace App\Models;

use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
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

    /** How many referred clients a company card carries before linking on. */
    public const REFERRED_PREVIEW = 12;

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

    /** The CIP numbering registry row, when this company is a service provider. */
    public function cipProvider(): HasOne
    {
        return $this->hasOne(CipProvider::class, 'company_id')->orderBy('id');
    }

    /** The firm's own people looking after this company. */
    public function staffAssignments(): HasMany
    {
        return $this->hasMany(CompanyStaffAssignment::class);
    }

    /**
     * @param  \Illuminate\Support\Collection<int, Client>  $clients
     * @return array<int, array<string, mixed>>
     */
    private function referredClientCards($clients): array
    {
        return $clients->take(self::REFERRED_PREVIEW)->map(fn (Client $c) => [
            'id' => $c->uid,
            'name' => $c->name,
            'initial' => $c->initial,
            'email' => $c->email,
        ])->values()->all();
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
        // `name, id` throughout: repeated names are common in the caseload, and
        // ordering by name alone leaves ties to the planner — so a list could
        // come back in a different order between identical requests.
        // withoutCipFilings: applicants referred by this firm must not appear
        // as Provider contacts when company_id was wrongly stamped on them.
        $people = $this->relationLoaded('clients')
            ? $this->clients
            : $this->clients()->withoutCipFilings()->orderBy('name')->orderBy('id')->get();

        return [
            'id' => $this->uid,
            'name' => $this->name,
            'logoUrl' => $this->logo_url,
            // The service-provider code that prefixes CIP application
            // numbers, when this company has one.
            'cipCode' => $this->cipProvider?->code,
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
            // Both counts follow the same rule as referredCount below: use the
            // figure the listing query already aggregated, and only fall back
            // to a query when a single company was fetched on its own. This one
            // used to always query, which is one round trip per company —
            // sixty-four of them, forty seconds, to print sixty-four numbers.
            'memberCount' => $this->current_members_count ?? $this->members()->current()->count(),
            'peopleCount' => $this->clients_count ?? $people->count(),
            // withCount() when the list loaded it, a query when a single
            // company was fetched on its own.
            'referredCount' => $this->referred_clients_count ?? $this->referredClients()->count(),
            /*
             * The first page of the people this company sent us. Capped hard:
             * the largest referral partner has eight thousand clients, and the
             * company card wants to show who they are, not carry the lot. The
             * page links through to the filtered directory for the rest.
             */
            'referred' => $this->relationLoaded('referredClients')
                ? $this->referredClientCards($this->referredClients)
                : $this->referredClientCards(
                    $this->referredClients()->orderBy('name')->orderBy('id')->limit(self::REFERRED_PREVIEW)->get()
                ),
            'people' => $people->map(function (Client $c) {
                $name = $c->contactDisplayName();
                $login = $c->hasLiveLogin() ? $c->user : null;

                return [
                    'id' => $c->uid,
                    'name' => $name,
                    'first' => \Illuminate\Support\Str::of($name)->trim()->explode(' ')->first(),
                    'initial' => $c->initial,
                    'initialColor' => $c->initial_color,
                    // Contact photo first, then the portal login's face — same
                    // fallback the rest of the hub uses for people with access.
                    'photo' => $c->photo_url ?: ($login?->photoUrl()),
                    'email' => $c->contactEmail(),
                    'hasLogin' => $login !== null,
                    // What the shared person card needs for Message / Call / Video.
                    'userId' => $login?->id,
                    'roles' => array_values(array_filter([
                        $login?->roleName(),
                    ])),
                    // Users-page wording: a Client on a firm is a Service
                    // Provider Contact; an admin keeps that account type name.
                    'accountType' => self::contactAccountTypeLabel($login),
                ];
            })->values()->all(),
        ];
    }

    /**
     * How the Provider contacts table names this person's portal account.
     *
     * Same labels the Users directory uses for external people. No login means
     * no account type to show — the contact row still exists in the firm.
     */
    private static function contactAccountTypeLabel(?User $login): ?string
    {
        if ($login === null) {
            return null;
        }

        $type = Role::of($login) ?? $login->account_type;

        return match ($type) {
            Role::SERVICE_PROVIDER_ADMIN => Role::SERVICE_PROVIDER_ADMIN,
            Role::CLIENT => 'Service Provider Contact',
            default => $type ? (string) $type : null,
        };
    }
}
