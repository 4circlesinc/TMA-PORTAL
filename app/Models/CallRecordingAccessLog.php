<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CallRecordingAccessLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'call_recording_id', 'user_id', 'action', 'ip', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }

    public function recording(): BelongsTo
    {
        return $this->belongsTo(CallRecording::class, 'call_recording_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
