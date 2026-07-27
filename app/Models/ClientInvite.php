<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A pending invitation for a client to create their portal login. The token is
 * the only key in the emailed link; accepting it creates the account and links
 * it to the client record (see ClientInviteController).
 */
#[Fillable(['client_id', 'email', 'token', 'expires_at', 'accepted_at', 'last_sent_at', 'created_by'])]
class ClientInvite extends Model
{
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
            'last_sent_at' => 'datetime',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public static function freshToken(): string
    {
        return Str::random(48);
    }

    public function isPending(): bool
    {
        return $this->accepted_at === null
            && ($this->expires_at === null || $this->expires_at->isFuture());
    }
}
