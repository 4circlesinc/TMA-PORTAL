<?php

namespace App\Mail;

use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Support\Files\Vault;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * The signed document, sent to everyone involved once it's fully signed.
 *
 * The copy is attached rather than linked: recipients have no portal account,
 * and the signing link is dead by now - a link would be useless to exactly the
 * people who most need the document.
 */
class SignatureCompleted extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public SignatureRequest $signatureRequest,
        public ?FileItem $signedFile,
        public ?string $recipientName = null,
    ) {}

    /** The template copy, built once for both the envelope and the body. */
    private ?array $postcardCopy = null;

    private function copy(): array
    {
        return $this->postcardCopy ??= \App\Support\Mail\Postcards::signatureCompleted(
            title: $this->signatureRequest->title,
            name: $this->recipientName,
            signers: $this->signatureRequest->recipients
                ->where('role', '!=', 'cc')
                ->map(fn ($r) => $r->name ?: $r->email)
                ->values()
                ->all(),
            attached: $this->signedFile !== null,
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

    /**
     * @return array<int, Attachment>
     *
     * Vault files are envelope-encrypted at rest (a `TMAENC1` header, see
     * App\Support\Security\Envelope), so attaching them straight off the disk
     * with fromStorageDisk() mailed the *ciphertext* - every recipient got a
     * "signed copy" their PDF reader refused to open. Read the bytes back
     * through the Vault, which decrypts, and attach those.
     */
    public function attachments(): array
    {
        if (! $this->signedFile) {
            return [];
        }

        $path = Vault::localCopy($this->signedFile);
        if (! $path) {
            // The document is gone or unreadable. The rest of the message
            // still tells them it was signed and where to find it; sending it
            // without the attachment beats not sending it at all.
            Log::error('Signed copy could not be read for the completion email', [
                'request' => $this->signatureRequest->uuid,
                'file' => $this->signedFile->uuid,
            ]);

            return [];
        }

        try {
            $bytes = (string) file_get_contents($path);
        } finally {
            Vault::cleanupLocalCopy($path);
        }

        return [
            Attachment::fromData(fn () => $bytes, $this->signedFile->name)
                ->withMime('application/pdf'),
        ];
    }
}
