<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One append-only entry in a request's audit trail. Written, never edited. */
#[Fillable([
    'signature_request_id', 'signature_recipient_id', 'user_id', 'action',
    'meta', 'ip', 'user_agent', 'created_at',
])]
class SignatureEvent extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(SignatureRequest::class, 'signature_request_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(SignatureRecipient::class, 'signature_recipient_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
