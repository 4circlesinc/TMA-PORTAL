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
 * Tells the sender that an approver asked for changes, and carries their
 * feedback. Like SignatureDeclined it goes to the sender only and carries no
 * signing link.
 */
class SignatureChangesRequested extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public SignatureRequest $signatureRequest,
        public string $comment,
        public ?string $by = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Changes requested on '.$this->signatureRequest->title,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.signatures.changes-requested',
            with: [
                'title' => $this->signatureRequest->title,
                'comment' => $this->comment,
                'by' => $this->by,
                'url' => url('/signatures'),
            ],
        );
    }
}
