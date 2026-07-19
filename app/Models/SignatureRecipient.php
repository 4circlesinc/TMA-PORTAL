<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One person asked to act on a request.
 *
 * `token_hash` is the SHA-256 of the signing link's raw token - the raw value
 * is shown once at issue time and never stored. Never serialize it.
 */
#[Fillable([
    'uuid', 'signature_request_id', 'name', 'email', 'role', 'signing_order',
    'status', 'token_hash', 'token_ciphertext', 'token_expires_at', 'invited_at',
    'reminded_at', 'viewed_at', 'signed_at', 'declined_at', 'decline_reason', 'comment', 'last_ip',
])]
#[Hidden(['token_hash', 'token_ciphertext'])]
class SignatureRecipient extends Model
{
    protected function casts(): array
    {
        return [
            'signing_order' => 'integer',
            'token_expires_at' => 'datetime',
            'invited_at' => 'datetime',
            'reminded_at' => 'datetime',
            'viewed_at' => 'datetime',
            'signed_at' => 'datetime',
            'declined_at' => 'datetime',
        ];
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(SignatureRequest::class, 'signature_request_id');
    }

    public function fields(): HasMany
    {
        return $this->hasMany(SignatureField::class);
    }

    /** A signing link works only before it expires and before it's used up. */
    public function canSign(): bool
    {
        if ($this->status === 'signed' || $this->status === 'declined') {
            return false;
        }

        return $this->token_expires_at === null || $this->token_expires_at->isFuture();
    }
}
