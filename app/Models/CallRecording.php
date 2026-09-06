<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A recording of one call between a staff member and a client.
 *
 * Created when recording is arranged, fed by chunk uploads while the call
 * runs, settled by finish. See the migration for why participants and the
 * client's name are denormalised onto the row.
 */
#[Fillable([
    'uuid', 'conversation_id', 'client_id', 'client_user_id', 'recorded_by',
    'participants', 'client_name', 'media', 'status',
    'disk', 'path', 'mime', 'size', 'duration_ms', 'last_seq',
    'started_at', 'ended_at', 'legal_hold', 'retain_until',
])]
class CallRecording extends Model
{
    public const STATUS_RECORDING = 'recording';

    public const STATUS_READY = 'ready';

    public const STATUS_FAILED = 'failed';

    protected function casts(): array
    {
        return [
            'participants' => 'array',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'retain_until' => 'datetime',
            'legal_hold' => 'boolean',
        ];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    /** A recording abandoned mid-call: never finished, no longer being fed. */
    public function isInterrupted(): bool
    {
        return $this->status === self::STATUS_RECORDING
            && $this->updated_at !== null
            && $this->updated_at->lt(now()->subMinutes(5));
    }
}
