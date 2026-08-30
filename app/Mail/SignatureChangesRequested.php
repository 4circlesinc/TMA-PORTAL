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

    /** The template copy, built once for both the envelope and the body. */
    private ?array $postcardCopy = null;

    private function copy(): array
    {
        return $this->postcardCopy ??= \App\Support\Mail\Postcards::signatureChangesRequested(
            title: $this->signatureRequest->title,
            comment: $this->comment,
            by: $this->by,
            url: url('/signatures'),
        );
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: (string) ($this->copy()['subject'] ?? ''));
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.postcard',
            with: \Illuminate\Support\Arr::except($this->copy(), ['subject']),
        );
    }
}
