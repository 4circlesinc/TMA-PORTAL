<?php

namespace App\Mail;

use App\Models\CalendarEvent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Every email an event sends: the invitation, a change notice, a cancellation,
 * and the organizer's copy of someone's response.
 *
 * One mailable rather than four because they carry the same payload and differ
 * only in wording — keeping them together is what stops the invitation and the
 * change notice that follows it describing the same event differently.
 *
 * Queued: a meeting with thirty invitees must not hold up the request that
 * created it.
 */
class CalendarEventNotice extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public const KIND_INVITATION = 'invitation';

    public const KIND_UPDATED = 'updated';

    public const KIND_CANCELLED = 'cancelled';

    public const KIND_RESPONSE = 'response';

    /**
     * @param  array<string, mixed>  $payload  pre-rendered event details; see
     *                                         App\Support\Calendar\EventNotifier::payload()
     */
    public function __construct(
        public CalendarEvent $event,
        public string $kind,
        public array $payload,
    ) {}

    /** The template copy, built once for both the envelope and the body. */
    private ?array $postcardCopy = null;

    private function copy(): array
    {
        return $this->postcardCopy ??= \App\Support\Mail\Postcards::calendar($this->kind, $this->payload);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: (string) ($this->copy()['subject'] ?? ($this->payload['title'] ?? 'Event')),
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
