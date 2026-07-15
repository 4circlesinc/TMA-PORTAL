<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'provider', 'provider_id', 'email', 'name', 'token', 'scopes', 'sync_email', 'sync_calendar', 'sync_onedrive', 'sync_sharepoint'])]
class ConnectedAccount extends Model
{
    protected function casts(): array
    {
        return [
            'token' => 'encrypted',
            'scopes' => 'array',
            'sync_email' => 'boolean',
            'sync_calendar' => 'boolean',
            'sync_onedrive' => 'boolean',
            'sync_sharepoint' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
