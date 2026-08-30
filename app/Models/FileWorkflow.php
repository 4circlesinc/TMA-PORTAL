<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'uuid', 'file_id', 'file_version_id', 'type', 'status', 'created_by',
    'created_by_member_id', 'message',
    'due_at', 'require_all', 'ordered', 'require_comment', 'lock_file', 'reminder_days',
    'superseded_by_version_id', 'signature_request_id', 'completed_at', 'cancelled_at',
])]
class FileWorkflow extends Model
{
    protected function casts(): array
    {
        return [
            'due_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'require_all' => 'boolean',
            'ordered' => 'boolean',
            'require_comment' => 'boolean',
            'lock_file' => 'boolean',
            'reminder_days' => 'integer',
        ];
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id');
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(FileVersion::class, 'file_version_id');
    }

    public function supersededByVersion(): BelongsTo
    {
        return $this->belongsTo(FileVersion::class, 'superseded_by_version_id');
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function senderMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'created_by_member_id');
    }

    public function steps(): HasMany
    {
        return $this->hasMany(FileWorkflowStep::class, 'workflow_id')->orderBy('position')->orderBy('id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(FileWorkflowEvent::class, 'workflow_id');
    }
}
