<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * An address a user's mailbox has exchanged mail with: how often, when last,
 * and the display name it most recently carried. Written by the sync
 * (MailCorrespondents::record), read by the compose typeahead.
 */
#[Fillable(['user_id', 'email', 'name', 'count', 'last_seen_at'])]
class MailCorrespondent extends Model
{
    protected function casts(): array
    {
        return [
            'count' => 'integer',
            'last_seen_at' => 'datetime',
        ];
    }
}
