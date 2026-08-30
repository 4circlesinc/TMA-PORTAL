<?php

namespace App\Mail;

use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/** "Please sign this" - carries the recipient's one-time signing link. */
class SignatureInvitation extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public SignatureRequest $signatureRequest,
        public SignatureRecipient $recipient,
        public string $signingUrl,
    ) {}

    /** The template copy, built once for both the envelope and the body. */
    private ?array $postcardCopy = null;

    private function copy(): array
    {
        return $this->postcardCopy ??= \App\Support\Mail\Postcards::signatureInvitation(
            title: $this->signatureRequest->title,
            sender: $this->signatureRequest->creator?->name,
            note: $this->signatureRequest->message,
            url: $this->signingUrl,
            name: $this->recipient->name,
            expiresAt: $this->signatureRequest->expires_at,
            action: $this->recipient->role === 'approver' ? 'approve' : 'sign',
        );
    }

    public function envelope(): Envelope
    {
        // The sender's own wording wins; the editable template is the default.
        return new Envelope(
            subject: $this->signatureRequest->subject ?: (string) ($this->copy()['subject'] ?? ''),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.postcard',
            with: \Illuminate\Support\Arr::except($this->copy(), ['subject']),
        );
    }
}
