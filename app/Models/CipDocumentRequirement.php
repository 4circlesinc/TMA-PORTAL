<?php

namespace App\Models;

use App\Support\Cip\ApplicantType;
use App\Support\Cip\DocumentTypes;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * One line of the master checklist: what an applicant of a given type owes.
 *
 * These are rows rather than constants because the list is the firm's to
 * change — a programme starts asking for a police certificate, a provider
 * stops asking for a marriage certificate — and none of that should wait for
 * a deployment. {@see DocumentTypes} holds the three slugs that existed before
 * this table; the requirements seeded from them keep the same keys, so a slot
 * filled last week still answers the same question.
 *
 * Requirements retire rather than disappear: `active` false takes a line off
 * every checklist built from here on, while the documents already filed
 * against it keep their label and their meaning. Deleting the row would leave
 * those slots describing a requirement nobody could look up.
 *
 * `applicant_type` is one of {@see ApplicantType}'s five, which is where the
 * vocabulary and the rule that picks it live. This table stores the answer,
 * it does not decide it.
 */
#[Fillable([
    'uuid', 'applicant_type', 'key', 'label', 'required', 'sort_order',
    'active', 'help', 'folder', 'at_pre_approval', 'at_post_approval', 'carry_forward', 'real_estate_only',
])]
class CipDocumentRequirement extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::creating(function (self $requirement) {
            $requirement->uuid ??= (string) Str::uuid();
        });

        static::saved(fn () => \App\Support\Cip\Requirements::flush());
        static::deleted(fn () => \App\Support\Cip\Requirements::flush());
    }

    protected function casts(): array
    {
        return [
            'required' => 'boolean',
            'active' => 'boolean',
            'at_pre_approval' => 'boolean',
            'at_post_approval' => 'boolean',
            'carry_forward' => 'boolean',
            'real_estate_only' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    /**
     * The checklist as it stands today, in the order it is meant to be read.
     *
     * The ordering belongs to the scope rather than to each caller: a list
     * that came back in whatever order the database felt like would reshuffle
     * itself between two reads of the same page. `sort_order` is hand-set, so
     * ties are ordinary and id settles them.
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('active', true)
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    /** The slots opened from this line — one per person who owes it. */
    public function documents(): HasMany
    {
        return $this->hasMany(CipDocument::class, 'requirement_id');
    }

    /** The heading this requirement sits under, in the words a reviewer reads. */
    public function applicantTypeLabel(): string
    {
        return ApplicantType::label((string) $this->applicant_type);
    }
}
