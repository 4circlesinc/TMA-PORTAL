<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Str;

/**
 * One attempt to deliver one transactional email.
 *
 * Written when the mailable is handed to the queue, then updated as the mail
 * events fire. Nothing here is inferred: `sent` is only set once the transport
 * has accepted the message, so an invitation that never left the queue reads as
 * `queued` on the invitation screen rather than pretending it was sent.
 */
#[Fillable([
    'uuid', 'recipient', 'subject', 'template', 'mailable', 'related_type',
    'related_id', 'status', 'message_id', 'error', 'retry_count', 'last_retry_at',
    'queued_at', 'sent_at', 'delivered_at', 'opened_at', 'clicked_at', 'failed_at',
])]
class EmailDelivery extends Model
{
    public const STATUS_QUEUED = 'queued';

    public const STATUS_SENT = 'sent';

    public const STATUS_DELIVERED = 'delivered';

    public const STATUS_OPENED = 'opened';

    public const STATUS_CLICKED = 'clicked';

    public const STATUS_FAILED = 'failed';

    public const STATUS_BOUNCED = 'bounced';

    public const STATUS_CANCELLED = 'cancelled';

    /** Statuses that mean the message did not get out. */
    public const FAILURE_STATUSES = [self::STATUS_FAILED, self::STATUS_BOUNCED];

    protected function casts(): array
    {
        return [
            'last_retry_at' => 'datetime',
            'queued_at' => 'datetime',
            'sent_at' => 'datetime',
            'delivered_at' => 'datetime',
            'opened_at' => 'datetime',
            'clicked_at' => 'datetime',
            'failed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (EmailDelivery $delivery) {
            $delivery->uuid ??= (string) Str::uuid();
        });
    }

    public function related(): MorphTo
    {
        return $this->morphTo();
    }

    public function hasFailed(): bool
    {
        return in_array($this->status, self::FAILURE_STATUSES, true);
    }

    /** The shape the invitation screen renders for a delivery attempt. */
    public function toRecord(): array
    {
        return [
            'id' => $this->uuid,
            'recipient' => $this->recipient,
            'subject' => $this->subject,
            'template' => $this->template,
            'status' => $this->status,
            'error' => $this->error,
            'retryCount' => $this->retry_count,
            'messageId' => $this->message_id,
            'queuedAt' => $this->queued_at?->toIso8601String(),
            'sentAt' => $this->sent_at?->toIso8601String(),
            'failedAt' => $this->failed_at?->toIso8601String(),
        ];
    }
}
