<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * One individual on an application — main applicant, sponsor, or dependent.
 * Qualified-dependent ordinals are computed from age (youngest = 1) and
 * recomputed on every add/edit/remove; they are never typed in.
 */
#[Fillable([
    'uuid', 'application_id', 'role', 'relationship', 'dependent_ordinal',
    'first_name', 'last_name', 'gender', 'date_of_birth', 'country_of_birth',
    'country_of_residence', 'occupation', 'passport_number', 'folder_id',
])]
class CipPerson extends Model
{
    use SoftDeletes;

    public const ROLE_MAIN_APPLICANT = 'main_applicant';

    public const ROLE_SPONSOR = 'sponsor';

    public const ROLE_DEPENDENT = 'dependent';

    public const RELATIONSHIP_SPOUSE = 'spouse';

    public const RELATIONSHIP_QUALIFIED = 'qualified_dependent';

    protected static function booted(): void
    {
        static::creating(function (self $person) {
            $person->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function fullName(): string
    {
        return trim(($this->first_name ?? '').' '.($this->last_name ?? ''));
    }
}
