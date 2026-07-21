<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One message in a connected mailbox, mirrored from Gmail or Microsoft Graph.
 *
 * `remote_id` is the provider's message id — it identifies the message inside
 * someone else's mailbox, so it stays server-side and the client addresses
 * messages by `uuid` instead.
 */
#[Fillable([
    'uuid', 'user_id', 'connected_account_id', 'remote_id', 'thread_id', 'folder',
    'subject', 'snippet', 'body_html', 'body_text', 'from_name', 'from_email',
    'to', 'cc', 'bcc', 'reply_to', 'is_read', 'is_starred', 'is_important',
    'has_attachments', 'sent_at',
])]
#[Hidden(['remote_id', 'connected_account_id'])]
class MailMessage extends Model
{
    protected function casts(): array
    {
        return [
            'to' => 'array',
            'cc' => 'array',
            'bcc' => 'array',
            'is_read' => 'boolean',
            'is_starred' => 'boolean',
            'is_important' => 'boolean',
            'has_attachments' => 'boolean',
            'sent_at' => 'datetime',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(MailAttachment::class);
    }

    public function labels(): BelongsToMany
    {
        return $this->belongsToMany(MailLabel::class, 'mail_label_message');
    }

    /**
     * The list-row shape the email UI renders. Bodies are deliberately absent —
     * the list never needs them, and they are the bulk of a mailbox.
     */
    public function toRow(): array
    {
        return [
            'id' => $this->uuid,
            'threadId' => $this->thread_id,
            'folder' => $this->folder,
            'sender' => $this->from_name ?: $this->from_email,
            'email' => $this->from_email,
            'subject' => $this->subject,
            'body' => $this->snippet,
            'time' => $this->listTime(),
            'dateLabel' => $this->sent_at?->format('M j, Y, g:i A'),
            'unread' => ! $this->is_read,
            'starred' => $this->is_starred,
            'important' => $this->is_important,
            'hasAttachments' => $this->has_attachments,
            'to' => $this->to ?? [],
            'labels' => $this->relationLoaded('labels')
                ? $this->labels->pluck('uuid')->all()
                : [],
            // Only ever populated from what is already stored locally — a
            // message nobody has opened yet has no attachment rows, and the
            // list must never fetch the provider just to describe them (that
            // is exactly the mistake that took the mailbox page down once
            // already). Capped well above any realistic "show 3 + N more" UI.
            //
            // Every named attachment is shown here, inline or not: senders
            // routinely paste real, named documents (a 2x2 photo, a scanned
            // ID) straight into the body, which gives them a Content-ID the
            // same as a decorative signature image would have. There is no
            // reliable way to tell those two apart, and for this business
            // hiding a genuine application document is the worse failure
            // mode - so is_inline is left to describe body rendering only,
            // never attachment visibility.
            'attachmentsPreview' => $this->relationLoaded('attachments')
                ? $this->attachments->take(8)->map->toRecord()->values()->all()
                : [],
            'attachmentCount' => $this->relationLoaded('attachments')
                ? $this->attachments->count()
                : null,
        ];
    }

    /** The full record for the reading pane, once the body has been fetched. */
    public function toRecord(): array
    {
        return $this->toRow() + [
            'bodyHtml' => $this->body_html,
            'bodyText' => $this->body_text,
            'cc' => $this->cc ?? [],
            'bcc' => $this->bcc ?? [],
            'replyTo' => $this->reply_to,
            'attachments' => $this->attachments->map->toRecord()->values()->all(),
        ];
    }

    /**
     * Gmail/Outlook both shorten the timestamp by age: today shows a clock,
     * this year a date, older years include the year.
     */
    private function listTime(): string
    {
        if (! $this->sent_at) {
            return '';
        }

        if ($this->sent_at->isToday()) {
            return $this->sent_at->format('H:i');
        }

        return $this->sent_at->isCurrentYear()
            ? $this->sent_at->format('M j')
            : $this->sent_at->format('M j, Y');
    }
}
