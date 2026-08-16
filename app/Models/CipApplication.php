<?php

namespace App\Models;

use App\Support\Cip\Status;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * One citizenship application — the native record the CBI Smartsheet mirror
 * is being replaced by. Status values live in {@see Status}; every change
 * goes through App\Support\Cip\Engine so the transition rules and the
 * append-only cip_events audit cannot be bypassed.
 */
// Deliberately narrow: only intake fields fill from arrays. The server owns
// status (Engine), both numbers (Numbering / the submission verb), the
// workflow dates, the decision and the lock — those are set explicitly by
// the code that has the authority, never mass-assigned from a request.
#[Fillable([
    'uuid', 'provider_id', 'client_id', 'created_by',
    'investment_type', 'investment_type_other', 'sponsored', 'unit_contact',
])]
class CipApplication extends Model
{
    use SoftDeletes;

    public const DECISION_GRANTED = 'granted';

    public const DECISION_DENIED = 'denied';

    protected static function booted(): void
    {
        static::creating(function (self $application) {
            $application->uuid ??= (string) Str::uuid();
            $application->status ??= Status::DRAFT;
        });
    }

    protected function casts(): array
    {
        return [
            'submitted_at' => 'date',
            'query_received_at' => 'date',
            'accepted_at' => 'date',
            'decided_at' => 'date',
            'locked_at' => 'datetime',
            'sponsored' => 'boolean',
        ];
    }

    /**
     * The one switch point for the dual-numbering rule: the internal number
     * until the government CIP number is recorded, the CIP number after.
     * Every user-facing surface — tables, dashboards, status screens, email
     * subjects, reports — renders this and nothing else, so entering the CIP
     * number flips them all at once. The internal number stays stored and
     * searchable for audit and invoicing.
     */
    public function displayNumber(): string
    {
        return $this->cip_number ?: ($this->internal_number ?? '');
    }

    public function isLocked(): bool
    {
        return $this->locked_at !== null;
    }

    public function provider(): BelongsTo
    {
        return $this->belongsTo(CipProvider::class, 'provider_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function assignedOfficer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_officer_id');
    }

    public function people(): HasMany
    {
        return $this->hasMany(CipPerson::class, 'application_id');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(CipApplicationAssignment::class, 'application_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(CipEvent::class, 'application_id');
    }

    /**
     * Main applicant + sponsor (if any) + dependents, shown as "F4". Family
     * size appears in the main table and in every email subject, so both read
     * this one computer.
     */
    public function familySize(): int
    {
        /*
         * Counted from the loaded family where there is one.
         *
         * `people()->count()` is a query, and this is read twice for every
         * application on a page — once for the number and once for the "F6"
         * label — so a sync page of fifty was a hundred COUNT statements for a
         * relation the same request had already fetched in full.
         */
        $people = $this->relationLoaded('people')
            ? $this->people->count()
            : $this->people()->count();

        return max(1, $people);
    }

    public function familyLabel(): string
    {
        return 'F'.$this->familySize();
    }
}
