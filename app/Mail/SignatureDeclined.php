<?php

namespace App\Mail;

use App\Models\SignatureRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Tells the sender someone refused to sign.
 *
 * Deliberately carries no signing link: this goes to a third party, and a
 * recipient's credential is theirs alone. Completion has its own mail
 * (SignatureCompleted) because it carries the signed document itself.
 */
class SignatureDeclined extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public SignatureRequest $signatureRequest,
        public ?string $reason = null,
        public ?string $by = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->signatureRequest->title.' was declined',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.signatures.declined',
            with: [
                'title' => $this->signatureRequest->title,
                'reason' => $this->reason,
                'by' => $this->by,
                'url' => url('/signatures'),
            ],
        );
    }
}
