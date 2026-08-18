<?php

namespace App\Support\Cip;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\User;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use App\Support\Signatures\Presenter as SignaturePresenter;

/**
 * §22 — one subject format, one recipient list, every status change.
 *
 * The postcard IS the email. Bells go to portal accounts with the email
 * channel off so the Notifier cannot send a second, differently-worded copy.
 */
class Notices
{
    /**
     * The filing subject:
     *
     *   [OFFICER INITIALS] - [STATUS] - [NUMBER] - [APPLICANT] (F[n]) - [DD.MM.YYYY]
     *
     * Initials are the actor who moved the file, or the assigned reviewing
     * officer when the system moved it (DELAYED). NEW APPLICATION before an
     * assignment uses the actor — the person who filed or created it.
     *
     * @param  array{number:string, applicant:string, familySize:int}  $facts
     */
    public static function line(array $facts, string $status, ?User $actor = null, ?string $initials = null): string
    {
        $initials = trim((string) ($initials ?? ($actor ? SignaturePresenter::initials($actor->name) : '')));

        return implode(' - ', array_filter([
            $initials !== '' ? $initials : null,
            Status::subjectLabel($status),
            $facts['number'],
            mb_strtoupper($facts['applicant']).' (F'.$facts['familySize'].')',
            now()->format('d.m.Y'),
        ], fn ($part) => $part !== null && $part !== ''));
    }

    /**
     * Tell every §22 recipient that this application now stands at `$to`.
     *
     * Called from {@see Engine::write} after the row and the event have both
     * landed, so nothing is announced that did not occur.
     */
    public static function announce(CipApplication $application, string $to, ?User $actor): void
    {
        if ($to === Status::DRAFT) {
            return;
        }

        $facts = Contacts::facts($application);
        $path = Contacts::path($application);
        $url = Contacts::url($application);
        $initials = self::initials($actor, $application);
        $template = self::template($to);
        $type = self::bellType($to);

        foreach (Contacts::notices($application) as $recipient) {
            $card = self::postcard($application, $facts, $to, $url, $actor, $initials, $recipient['name']);

            Deliveries::send($card, $recipient['email'], $application, $template, immediate: true);

            if ($recipient['userId'] === null) {
                continue;
            }

            Notifier::send([
                'user' => User::find($recipient['userId']),
                'actor' => $actor,
                'type' => $type,
                'title' => $facts['number'].' — '.Status::label($to),
                'message' => self::bellMessage($application, $to, $facts),
                'subject' => $application,
                'action_url' => $path,
                'email' => false,
            ]);
        }
    }

    private static function initials(?User $actor, CipApplication $application): string
    {
        if ($actor?->name) {
            return SignaturePresenter::initials($actor->name);
        }

        $officer = Contacts::reviewingOfficer($application)[0]['name'] ?? null;

        return $officer ? SignaturePresenter::initials($officer) : '';
    }

    /**
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    private static function postcard(
        CipApplication $application,
        array $facts,
        string $to,
        string $url,
        ?User $actor,
        string $initials,
        ?string $recipientName = null,
    ): Postcard {
        $subject = self::line($facts, $to, $actor, $initials);

        return match ($to) {
            Status::UPDATE_REQUIRED => Postcards::cipUpdatesRequired(
                $facts, self::sentBack($application), $actor, $url, $recipientName, $subject,
            ),
            Status::READY_TO_SUBMIT => Postcards::cipReadyToSubmit($facts, $url, $recipientName, $subject),
            Status::NON_COMPLIANT => Postcards::cipNonCompliant(
                $facts, $url, $application->query_received_at?->toDateString(), $recipientName, $actor, $subject,
            ),
            Status::DELAYED => Postcards::cipDelayed(
                $facts, $url, $application->accepted_at?->toDateString(), self::daysDelayed($application), $recipientName, $subject,
            ),
            Status::GRANTED, Status::DENIED => Postcards::cipDecision(
                $facts, $url, $to, $application->decided_at?->toDateString(), $recipientName, $actor, $subject,
                Letters::copy($application, $to, $recipientName),
            ),
            Status::REVIEW_APPLICATION => Postcards::cipAssigned(
                array_merge($facts, [
                    'statusLabel' => Status::label($to),
                    'roleLabel' => Assignments::roleLabel(CipAccess::REVIEWING_OFFICER),
                ]),
                $actor,
                $url,
                $subject,
                $recipientName,
            ),
            default => Postcards::cipStatus($facts, $to, $url, $recipientName, $subject),
        };
    }

    private static function daysDelayed(CipApplication $application): int
    {
        return $application->accepted_at
            ? (int) $application->accepted_at->copy()->startOfDay()->diffInDays(now()->startOfDay())
            : Delay::DAYS;
    }

    /**
     * @return list<array{label:string, reason:?string}>
     */
    private static function sentBack(CipApplication $application): array
    {
        return CipDocument::query()
            ->where('application_id', $application->id)
            ->where('status', DocumentStatus::UPDATE_REQUIRED)
            ->with(['comments' => fn ($q) => $q->latest('id')->limit(1)])
            ->orderBy('id')
            ->get()
            ->map(fn (CipDocument $slot) => [
                'label' => $slot->label,
                'reason' => $slot->comments->first()?->body,
            ])
            ->all();
    }

    private static function template(string $status): string
    {
        return match ($status) {
            Status::UPDATE_REQUIRED => 'cip-updates-required',
            Status::READY_TO_SUBMIT => 'cip-ready-to-submit',
            Status::NON_COMPLIANT => 'cip-non-compliant',
            Status::DELAYED => 'cip-delayed',
            Status::GRANTED => 'cip-granted',
            Status::DENIED => 'cip-denied',
            Status::REVIEW_APPLICATION => 'cip-assigned',
            default => 'cip-status',
        };
    }

    private static function bellType(string $status): string
    {
        return match ($status) {
            Status::UPDATE_REQUIRED => 'cip.updates-required',
            Status::READY_TO_SUBMIT => 'cip.ready-to-submit',
            Status::NON_COMPLIANT => 'cip.non-compliant',
            Status::DELAYED => 'cip.delayed',
            Status::GRANTED => 'cip.granted',
            Status::DENIED => 'cip.denied',
            Status::REVIEW_APPLICATION => 'cip.assigned',
            default => 'cip.status',
        };
    }

    /**
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    private static function bellMessage(CipApplication $application, string $to, array $facts): string
    {
        return match ($to) {
            Status::UPDATE_REQUIRED => 'Documents were sent back with notes.',
            Status::READY_TO_SUBMIT => 'Confirm submission to lock the original package.',
            Status::NON_COMPLIANT => 'The Unit has requested additional information.',
            Status::DELAYED => self::daysDelayed($application).' days have passed since acceptance with no decision.',
            Status::GRANTED => 'The Unit has granted this application.',
            Status::DENIED => 'The Unit has denied this application.',
            default => $facts['applicant'].' now stands at '.Status::label($to).'.',
        };
    }
}
