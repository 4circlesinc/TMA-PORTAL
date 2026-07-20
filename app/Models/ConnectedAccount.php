<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'provider', 'provider_id', 'email', 'name', 'token', 'scopes', 'sync_email', 'sync_calendar', 'sync_onedrive', 'sync_sharepoint', 'mail_cursor', 'mail_synced_at', 'mail_status', 'mail_error'])]
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
            'mail_synced_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(MailMessage::class);
    }

    /**
     * Whether this account granted enough to run the mailbox. Read-only email
     * scopes are enough to sync, but not to send or move anything — the
     * settings panel uses this to prompt a re-connect rather than failing
     * later on the first action the user takes.
     */
    public function canWriteMail(): bool
    {
        $granted = $this->scopes ?? [];

        $write = $this->provider === 'google'
            ? ['https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/']
            : ['Mail.ReadWrite'];

        foreach ($write as $scope) {
            if (in_array($scope, $granted, true)) {
                return true;
            }
        }

        return false;
    }
}
