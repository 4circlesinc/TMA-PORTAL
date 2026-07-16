<?php

namespace App\Mail;

use App\Models\FileItem;
use App\Models\SignatureRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The signed document, sent to everyone involved once it's fully signed.
 *
 * The copy is attached rather than linked: recipients have no portal account,
 * and the signing link is dead by now - a link would be useless to exactly the
 * people who most need the document.
 */
class SignatureCompleted extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public SignatureRequest $signatureRequest,
        public ?FileItem $signedFile,
        public ?string $recipientName = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Signed: '.$this->signatureRequest->title,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.signatures.completed',
            with: [
                'title' => $this->signatureRequest->title,
                'name' => $this->recipientName,
                'signers' => $this->signatureRequest->recipients
                    ->where('role', '!=', 'cc')
                    ->map(fn ($r) => $r->name ?: $r->email)
                    ->values()
                    ->all(),
                'attached' => $this->signedFile !== null,
            ],
        );
    }

    /** @return array<int, Attachment> */
    public function attachments(): array
    {
        if (! $this->signedFile) {
            return [];
        }

        return [
            Attachment::fromStorageDisk($this->signedFile->disk, $this->signedFile->storage_path)
                ->as($this->signedFile->name)
                ->withMime('application/pdf'),
        ];
    }
}
