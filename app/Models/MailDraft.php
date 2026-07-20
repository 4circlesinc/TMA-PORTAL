<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** An in-progress compose window, mirrored to the provider's Drafts folder. */
#[Fillable([
    'uuid', 'user_id', 'connected_account_id', 'remote_id', 'to', 'cc', 'bcc',
    'subject', 'body_html', 'mode', 'in_reply_to', 'thread_id',
])]
#[Hidden(['remote_id', 'connected_account_id'])]
class MailDraft extends Model
{
    protected function casts(): array
    {
        return [
            'to' => 'array',
            'cc' => 'array',
            'bcc' => 'array',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }

    public function toRecord(): array
    {
        return [
            'id' => $this->uuid,
            'to' => $this->to ?? [],
            'cc' => $this->cc ?? [],
            'bcc' => $this->bcc ?? [],
            'subject' => $this->subject,
            'bodyHtml' => $this->body_html,
            'mode' => $this->mode,
            'inReplyTo' => $this->in_reply_to,
            'threadId' => $this->thread_id,
            'updatedAt' => $this->updated_at?->toIso8601String(),
        ];
    }
}
