<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * A user label. Gmail labels map one-to-one; Graph has no labels, so the
 * Microsoft provider maps these onto Outlook categories by name.
 */
#[Fillable([
    'uuid', 'user_id', 'connected_account_id', 'remote_id', 'name', 'tone', 'is_system',
])]
#[Hidden(['remote_id', 'connected_account_id'])]
class MailLabel extends Model
{
    /** The colours the email UI ships swatches for. */
    public const TONES = ['blue', 'green', 'purple', 'orange', 'red', 'indigo', 'gray'];

    /** remote_id prefix for labels created in the portal that the provider refused/cannot hold. */
    public const LOCAL_PREFIX = 'local:';

    protected function casts(): array
    {
        return ['is_system' => 'boolean'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }

    public function messages(): BelongsToMany
    {
        return $this->belongsToMany(MailMessage::class, 'mail_label_message');
    }

    /** A label that exists only in the portal — never call the provider for it. */
    public function isLocalOnly(): bool
    {
        return str_starts_with((string) $this->remote_id, self::LOCAL_PREFIX);
    }

    public function toRecord(): array
    {
        return [
            'id' => $this->uuid,
            'name' => $this->name,
            'tone' => $this->tone,
            // Present when the query loaded it (withCount); the sidebar badge.
            'count' => $this->messages_count !== null ? (int) $this->messages_count : null,
        ];
    }
}
