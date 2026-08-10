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
#[Fillable([
    'uid', 'user_id', 'folder_id', 'company_id', 'name', 'client_type', 'company',
    'referral_type', 'referred_by_company_id', 'email', 'phone', 'initial',
    'initial_color', 'data', 'created_by',
])]
class Client extends Model
{
    use SoftDeletes;

    /** What the record is: one person, or a company applying in its own name. */
    public const TYPES = [
        'private' => 'Private',
        'company' => 'Company',
    ];

    /**
     * Who sent the client to the firm. `private` is an answer — they came on
     * their own — where `none` means nobody has recorded one yet.
     */
    public const REFERRAL_COMPANY = 'company';

    public const REFERRAL_PRIVATE = 'private';

    public const REFERRAL_NONE = 'none';

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

    /** Optional company this person belongs to. */
    public function companyRecord(): BelongsTo
    {
        return $this->belongsTo(Company::class, 'company_id');
    }

    /**
     * The company that referred this client. Not membership: the referrer gets
     * no reach over the record, which is why this is its own key rather than
     * a second use of `company_id`.
     */
    public function referredByCompany(): BelongsTo
    {
        return $this->belongsTo(Company::class, 'referred_by_company_id');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(ClientAssignment::class);
    }

    public function typeLabel(): string
    {
        return self::TYPES[$this->client_type] ?? self::TYPES['private'];
    }

    /** What the directory's "Referred by" column shows: a name, or an answer. */
    public function referralLabel(?Company $referrer = null): ?string
    {
        if ($this->referral_type === self::REFERRAL_PRIVATE) {
            return 'Private';
        }

        if ($this->referral_type === self::REFERRAL_COMPANY) {
            $referrer ??= $this->referredByCompany;

            return $referrer?->name;
        }

        return null;
    }

    /**
     * The record shape the clients page expects: a directory entry (id, name,
     * avatar fallback) with the full profile nested under `profile`.
     *
     * @return array<string, mixed>
     */
    public function toRecord(): array
    {
        $company = $this->relationLoaded('companyRecord')
            ? $this->companyRecord
            : $this->companyRecord()->first();

        $referrer = $this->referral_type === self::REFERRAL_COMPANY
            ? ($this->relationLoaded('referredByCompany')
                ? $this->referredByCompany
                : $this->referredByCompany()->first())
            : null;

        return [
            'id' => $this->uid,
            'name' => $this->name,
            'initial' => $this->initial,
            'initialColor' => $this->initial_color,
            'profile' => $this->data ?? [],
            'folderUuid' => $this->folder?->uuid,
            'hasLogin' => $this->user_id !== null,
            'userId' => $this->user_id,
            'companyId' => $company?->uid,
            'companyName' => $company?->name ?? $this->company,
            'clientType' => $this->client_type ?? 'private',
            'clientTypeLabel' => $this->typeLabel(),
            'referralType' => $this->referral_type ?? self::REFERRAL_NONE,
            'referredByCompanyId' => $referrer?->uid,
            'referredByLabel' => $this->referralLabel($referrer),
        ];
    }

    /**
     * The same record without `profile` — what the directory listing needs.
     *
     * `data` is the widest column on the table and the directory draws none of
     * it: the list shows a name, a type, a referrer and one contact line, all
     * of which are denormalised columns. Shipping the blob anyway meant the
     * index endpoint read, hydrated and serialised eleven thousand full contact
     * records to render a hundred rows — 9.6 MB of JSON and 127 MB of PHP
     * memory per request, which is what was exhausting the container.
     *
     * The profile is fetched per client by {@see ClientsController::show()}
     * when a record is actually opened. Anything added here must be readable
     * without `data`, because the listing query no longer selects it.
     *
     * @return array<string, mixed>
     */
    public function toDirectoryRecord(): array
    {
        $company = $this->relationLoaded('companyRecord')
            ? $this->companyRecord
            : $this->companyRecord()->first();

        $referrer = $this->referral_type === self::REFERRAL_COMPANY
            ? ($this->relationLoaded('referredByCompany')
                ? $this->referredByCompany
                : $this->referredByCompany()->first())
            : null;

        return [
            'id' => $this->uid,
            'name' => $this->name,
            'initial' => $this->initial,
            'initialColor' => $this->initial_color,
            'folderUuid' => $this->folder?->uuid,
            'hasLogin' => $this->user_id !== null,
            'userId' => $this->user_id,
            'companyId' => $company?->uid,
            'companyName' => $company?->name ?? $this->company,
            'clientType' => $this->client_type ?? 'private',
            'clientTypeLabel' => $this->typeLabel(),
            'referralType' => $this->referral_type ?? self::REFERRAL_NONE,
            'referredByCompanyId' => $referrer?->uid,
            'referredByLabel' => $this->referralLabel($referrer),
            // The Contact column, from the denormalised copies rather than the
            // blob. Every write goes through ClientsController::columns(),
            // which keeps both in step with the profile.
            'contact' => $this->email ?: ($this->phone ?: null),
        ];
    }
}
