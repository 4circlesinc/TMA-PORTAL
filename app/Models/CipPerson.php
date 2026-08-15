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

    /**
     * This person's document checklist — one row per requirement.
     *
     * Ordered by creation, which is the order the requirement list defines:
     * a checklist that came back in whatever order the database felt like
     * would reshuffle itself between two reads of the same page.
     */
    public function documents(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(CipDocument::class, 'person_id')->orderBy('id');
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'folder_id');
    }

    public function fullName(): string
    {
        return trim(($this->first_name ?? '').' '.($this->last_name ?? ''));
    }

    /**
     * The profile picture, which is the passport photo.
     *
     * One likeness per person: the photo they filed is the face the portal
     * draws, so a table row and the filed application can never disagree
     * about who this is.
     */
    public function photoUrl(): ?string
    {
        return $this->photo_url;
    }
}
