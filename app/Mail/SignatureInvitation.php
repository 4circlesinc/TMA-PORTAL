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

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->signatureRequest->subject
                ?: 'Please sign: '.$this->signatureRequest->title,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.signatures.invitation',
            with: [
                'title' => $this->signatureRequest->title,
                'sender' => $this->signatureRequest->creator?->name,
                // Deliberately not "message": Laravel injects its own
                // $message (the Illuminate\Mail\Message) into every mail view,
                // and ours would be silently shadowed by it.
                'note' => $this->signatureRequest->message,
                'url' => $this->signingUrl,
                'name' => $this->recipient->name,
                'expiresAt' => $this->signatureRequest->expires_at,
                'action' => $this->recipient->role === 'approver' ? 'approve' : 'sign',
            ],
        );
    }
}
