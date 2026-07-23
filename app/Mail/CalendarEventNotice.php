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

    public function envelope(): Envelope
    {
        $title = $this->payload['title'] ?? 'Event';

        $subject = match ($this->kind) {
            self::KIND_UPDATED => 'Updated: '.$title,
            self::KIND_CANCELLED => 'Cancelled: '.$title,
            self::KIND_RESPONSE => sprintf(
                '%s %s: %s',
                $this->payload['attendee'] ?? 'Someone',
                $this->payload['responseLabel'] ?? 'responded',
                $title,
            ),
            default => 'Invitation: '.$title,
        };

        return new Envelope(subject: $subject);
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.calendar.'.$this->kind,
            with: $this->payload + [
                // Every template reads these; defaulted so a partial payload
                // can never blow up mid-send for the whole invitee list.
                'title' => $this->payload['title'] ?? 'Event',
                'name' => $this->payload['name'] ?? null,
                'organizer' => $this->payload['organizer'] ?? null,
                'url' => $this->payload['url'] ?? null,
                'whenLabel' => $this->payload['whenLabel'] ?? '',
                'location' => $this->payload['location'] ?? null,
                'description' => $this->payload['description'] ?? null,
            ],
        );
    }
}
