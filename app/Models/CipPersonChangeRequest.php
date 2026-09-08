<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A proposed correction to a person on a post-approval file.
 *
 * See the migration for why this exists: post-approval details are the firm's
 * to keep right, but an employee or the provider side proposes rather than
 * changes, and an administrator decides.
 */
class CipPersonChangeRequest extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_DECLINED = 'declined';

    protected $fillable = [
        'uuid', 'application_id', 'person_id', 'requested_by',
        'changes', 'before', 'note', 'status',
        'decided_by', 'decided_at', 'decision_note',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $row) {
            $row->uuid ??= (string) Str::uuid();
            $row->status ??= self::STATUS_PENDING;
        });
    }

    protected function casts(): array
    {
        return [
            'changes' => 'array',
            'before' => 'array',
            'decided_at' => 'datetime',
        ];
    }

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function person(): BelongsTo
    {
        return $this->belongsTo(CipPerson::class, 'person_id');
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }
}
