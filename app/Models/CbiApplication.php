<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

#[Fillable([
    'uuid', 'dedupe_key', 'needs_review',
    'applicant_number', 'applicant_name', 'main_applicant_name', 'date_of_birth',
    'nationality', 'number_of_dependents', 'family_structure', 'contact_details',
    'stage', 'status', 'application_review', 'progress', 'granted', 'closed', 'action_needed',
    'referred_by', 'promoter', 'service_provider', 'main_contact', 'assigned_to', 'assigned_to_canonical',
    'verification_officer', 'dd_officer', 'pa_assignment', 'file_owner',
    'submitted_by', 'verified_by', 'assigned_user_id', 'client_id',
    'investment_option', 'application_type', 'clio_matter_number', 'clio_matter_link', 'file_location',
    'received_at', 'pre_processing_at', 'submitted_at', 'accepted_at', 'compliance_due_at',
    'decision_required_at', 'decision_received_at',
    'cor_submitted_at', 'cor_received_at', 'cor_number',
    'nic_request_sent_at', 'nic_letter_received_at',
    'passport_pads_received_at', 'ready_for_passport_submission_at',
    'passport_submitted_at', 'passport_received_at', 'passport_number',
    'originals_delivered_at', 'final_documents_sent_at',
    'appeal_requested_at', 'appeal_sent_at', 'appeal_decided_at',
    'notes', 'latest_comment', 'issues_log', 'agent_assessment', 'assessment_response',
    'financials', 'extra',
    'source_sheet_remote_id', 'source_row_remote_id', 'source_permalink', 'source_modified_at',
    'first_imported_at', 'synced_at',
])]
class CbiApplication extends Model
{
    use SoftDeletes;

    public const STAGE_APPLICATIONS = 'applications';
    public const STAGE_ASSESSMENT = 'assessment';
    public const STAGE_TRACKER = 'tracker';
    public const STAGE_CLOSED = 'closed';

    public const STAGES = [
        self::STAGE_APPLICATIONS,
        self::STAGE_ASSESSMENT,
        self::STAGE_TRACKER,
        self::STAGE_CLOSED,
    ];

    protected static function booted(): void
    {
        static::creating(function (self $application) {
            $application->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'needs_review' => 'boolean',
            'granted' => 'boolean',
            'closed' => 'boolean',
            'number_of_dependents' => 'integer',
            'date_of_birth' => 'date',
            'received_at' => 'date',
            'pre_processing_at' => 'date',
            'submitted_at' => 'date',
            'accepted_at' => 'date',
            'compliance_due_at' => 'date',
            'decision_required_at' => 'date',
            'decision_received_at' => 'date',
            'cor_submitted_at' => 'date',
            'cor_received_at' => 'date',
            'nic_request_sent_at' => 'date',
            'nic_letter_received_at' => 'date',
            'passport_pads_received_at' => 'date',
            'ready_for_passport_submission_at' => 'date',
            'passport_submitted_at' => 'date',
            'passport_received_at' => 'date',
            'originals_delivered_at' => 'date',
            'final_documents_sent_at' => 'date',
            'appeal_requested_at' => 'date',
            'appeal_sent_at' => 'date',
            'appeal_decided_at' => 'date',
            'financials' => 'array',
            'extra' => 'array',
            'source_modified_at' => 'datetime',
            'first_imported_at' => 'datetime',
            'synced_at' => 'datetime',
        ];
    }

    public function sources(): HasMany
    {
        return $this->hasMany(CbiApplicationSource::class, 'application_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(CbiApplicationEvent::class, 'application_id');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(CbiComment::class, 'application_id');
    }

    public function assessmentItems(): HasMany
    {
        return $this->hasMany(CbiAssessmentItem::class, 'application_id');
    }

    public function assignedUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_user_id');
    }

    /**
     * The applicant's record in the firm's client directory. Set by
     * App\Support\Cbi\ClientHubImporter; null until the caseload is imported,
     * or where the row carries no applicant name to file a person under.
     */
    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class, 'client_id');
    }
}
