<?php

namespace App\Mail;

use App\Models\EmailDelivery;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The one transactional email. Every portal email is a payload for the approved
 * postcard design (resources/views/emails/postcard.blade.php) — the inlined,
 * email-safe twin of what /design/mail previews. Build these through
 * App\Support\Mail\Postcards, which holds the copy for each email.
 *
 * When sent through App\Support\Mail\Deliveries the mailable carries a
 * `deliveryUuid`. That id rides along in a header so the mail events can find
 * the EmailDelivery row again, and it is what lets {@see self::failed()} record
 * a transport failure against the thing the mail was about — without it, a
 * failed invitation email would be invisible to the staff who sent it.
 */
class Postcard extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /** The header the mail listeners read to find this send's delivery row. */
    public const DELIVERY_HEADER = 'X-TMA-Delivery';

    /** @param array<string,mixed> $payload */
    public function __construct(
        public string $subjectLine,
        public array $payload,
        public ?string $deliveryUuid = null,
        public ?\App\Models\FileItem $attachment = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->subjectLine);
    }

    public function headers(): Headers
    {
        return new Headers(text: $this->deliveryUuid
            ? [self::DELIVERY_HEADER => $this->deliveryUuid]
            : []);
    }

    public function content(): Content
    {
        // Laravel injects its own $message into every mail view; our payload is
        // passed under explicit keys so nothing collides with it.
        return new Content(view: 'emails.postcard', with: $this->payload);
    }

    /** @return array<int, Attachment> */
    public function attachments(): array
    {
        if ($this->attachment === null) {
            return [];
        }

        return [
            Attachment::fromStorageDisk($this->attachment->disk, $this->attachment->storage_path)
                ->as($this->attachment->name)
                ->withMime('application/pdf'),
        ];
    }

    /**
     * Called by Laravel's SendQueuedMailable when the job gives up. This is the
     * only place a queued transport failure surfaces, so the delivery row is
     * marked here rather than left sitting at "queued" for ever.
     */
    public function failed(Throwable $e): void
    {
        if (! $this->deliveryUuid) {
            return;
        }

        try {
            EmailDelivery::where('uuid', $this->deliveryUuid)->first()?->forceFill([
                'status' => EmailDelivery::STATUS_FAILED,
                'error' => mb_substr($e->getMessage(), 0, 2000),
                'failed_at' => now(),
            ])->save();
        } catch (Throwable $inner) {
            // Tracking must never be the reason a failure goes unlogged.
            Log::warning('Could not record mail failure: '.$inner->getMessage());
        }
    }
}
