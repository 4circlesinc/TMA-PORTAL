<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'uuid', 'workflow_id', 'user_id', 'email', 'name', 'role', 'position', 'status',
    'invited_at', 'responded_at', 'comment', 'delegated_to_id', 'delegated_from_id',
    'last_reminded_at', 'reminder_count',
])]
class FileWorkflowStep extends Model
{
    protected function casts(): array
    {
        return [
            'invited_at' => 'datetime',
            'responded_at' => 'datetime',
            'last_reminded_at' => 'datetime',
            'position' => 'integer',
            'reminder_count' => 'integer',
        ];
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(FileWorkflow::class, 'workflow_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function delegatedTo(): BelongsTo
    {
        return $this->belongsTo(User::class, 'delegated_to_id');
    }

    /** Still waiting on this person. */
    public function isOpen(): bool
    {
        return in_array($this->status, ['pending', 'invited'], true);
    }
}
