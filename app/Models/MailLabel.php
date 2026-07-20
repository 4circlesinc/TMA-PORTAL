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

    public function toRecord(): array
    {
        return [
            'id' => $this->uuid,
            'name' => $this->name,
            'tone' => $this->tone,
        ];
    }
}
