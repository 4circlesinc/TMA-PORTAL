<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'remote_id', 'name', 'permalink', 'folder_path', 'category',
    'version', 'synced_version', 'row_count', 'created_at_remote', 'modified_at_remote',
    'status', 'sync_enabled', 'last_synced_at', 'last_success_at', 'last_error', 'error_count',
    'cbi_application_id', 'match_confidence',
])]
class SmartsheetSheet extends Model
{
    protected $attributes = [
        'status' => self::STATUS_IDLE,
        'sync_enabled' => true,
        'category' => self::CATEGORY_OTHER,
        'error_count' => 0,
    ];

    public const STATUS_IDLE = 'idle';
    public const STATUS_SYNCING = 'syncing';
    public const STATUS_ERROR = 'error';
    public const STATUS_GONE = 'gone';

    public const CATEGORY_MASTER_TRACKER = 'master_tracker';
    public const CATEGORY_CLOSED = 'closed';
    public const CATEGORY_ASSESSMENT = 'assessment';
    public const CATEGORY_PENDING_REVIEW = 'pending_review';
    public const CATEGORY_SUBMISSION = 'submission';
    public const CATEGORY_POST_APPROVAL = 'post_approval';
    public const CATEGORY_OTHER = 'other';

    /** Categories whose rows map into cbi_applications. */
    public const APPLICATION_CATEGORIES = [
        self::CATEGORY_MASTER_TRACKER,
        self::CATEGORY_CLOSED,
        self::CATEGORY_PENDING_REVIEW,
        self::CATEGORY_SUBMISSION,
    ];

    protected function casts(): array
    {
        return [
            'sync_enabled' => 'boolean',
            'version' => 'integer',
            'synced_version' => 'integer',
            'row_count' => 'integer',
            'error_count' => 'integer',
            'created_at_remote' => 'datetime',
            'modified_at_remote' => 'datetime',
            'last_synced_at' => 'datetime',
            'last_success_at' => 'datetime',
        ];
    }

    public function columns(): HasMany
    {
        return $this->hasMany(SmartsheetColumn::class, 'sheet_id');
    }

    public function rows(): HasMany
    {
        return $this->hasMany(SmartsheetRow::class, 'sheet_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(SmartsheetAttachment::class, 'sheet_id');
    }

    public function discussions(): HasMany
    {
        return $this->hasMany(SmartsheetDiscussion::class, 'sheet_id');
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CbiApplication::class, 'cbi_application_id');
    }

    public function mapsToApplications(): bool
    {
        return in_array($this->category, self::APPLICATION_CATEGORIES, true);
    }
}
