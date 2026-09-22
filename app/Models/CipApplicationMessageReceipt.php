<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The first time this person saw this line on an application's thread.
 *
 * A provider's row is only ever written for the service-provider lane.
 * Internal notes are not in the query that records their cursor, so a
 * receipt here cannot claim they saw a note they were never shown.
 */
class CipApplicationMessageReceipt extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'application_id', 'message_id', 'user_id', 'seen_at',
    ];

    protected function casts(): array
    {
        return [
            'seen_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(CipApplicationMessage::class, 'message_id');
    }
}
