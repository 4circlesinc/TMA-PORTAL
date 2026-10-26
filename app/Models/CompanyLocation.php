<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * One office of a service provider: the main office, or a branch.
 *
 * Users are company members pointed here. The main office is created with
 * the firm and is not removed.
 */
#[Fillable(['uid', 'company_id', 'name', 'kind'])]
class CompanyLocation extends Model
{
    use SoftDeletes;

    public const KIND_MAIN = 'main_office';

    public const KIND_BRANCH = 'branch';

    protected static function booted(): void
    {
        static::creating(function (CompanyLocation $location) {
            $location->uid ??= Str::lower((string) Str::ulid());
        });
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }

    public function members(): HasMany
    {
        return $this->hasMany(CompanyMember::class, 'location_id');
    }

    public function isMain(): bool
    {
        return $this->kind === self::KIND_MAIN;
    }

    /** @return array<string, mixed> */
    public function toRecord(): array
    {
        return [
            'id' => $this->uid,
            'name' => $this->name,
            'kind' => $this->kind,
        ];
    }
}
