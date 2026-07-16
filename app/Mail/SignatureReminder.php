<?php

namespace App\Mail;

use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/** A nudge for a link that's already out. Same link, not a new one. */
class SignatureReminder extends Mailable
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
            subject: 'Reminder: '.$this->signatureRequest->title.' still needs your signature',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.signatures.reminder',
            with: [
                'title' => $this->signatureRequest->title,
                'sender' => $this->signatureRequest->creator?->name,
                'url' => $this->signingUrl,
                'name' => $this->recipient->name,
                'expiresAt' => $this->signatureRequest->expires_at,
            ],
        );
    }
}
