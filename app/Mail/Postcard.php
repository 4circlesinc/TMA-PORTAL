<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The one transactional email. Every portal email is a payload for the approved
 * postcard design (resources/views/emails/postcard.blade.php) — the inlined,
 * email-safe twin of what /design/mail previews. Build these through
 * App\Support\Mail\Postcards, which holds the copy for each email.
 */
class Postcard extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /** @param array<string,mixed> $payload */
    public function __construct(
        public string $subjectLine,
        public array $payload,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->subjectLine);
    }

    public function content(): Content
    {
        // Laravel injects its own $message into every mail view; our payload is
        // passed under explicit keys so nothing collides with it.
        return new Content(view: 'emails.postcard', with: $this->payload);
    }
}
