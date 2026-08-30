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
use Illuminate\Support\Str;

/**
 * §22, one subject format, one recipient list, every status change.
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
     * assignment uses the actor, the person who filed or created it.
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
        $url = Contacts::url($application);
        $initials = self::initials($actor, $application);

        self::fanOut(
            $application,
            fn (?string $name) => self::postcard($application, $facts, $to, $url, $actor, $initials, $name),
            self::template($to),
            self::bellType($to),
            $actor,
            $facts['number'].': '.Status::label($to),
            self::bellMessage($application, $to, $facts),
        );
    }

    /**
     * One document sent back, named on its own.
     *
     * {@see announce()} fires when the APPLICATION enters Updates Required
     * and lists every refused slot. A second refusal a day later moves no
     * status, so nothing fired, and the firm learned of it only by opening
     * the checklist. Every refusal is work the provider side has to do, so
     * every one is a notice: same recipients, same filing subject, this one
     * naming only the document that moved. Callers skip it when the
     * application's own notice went out a moment ago and already named it.
     */
    public static function documentSentBack(CipDocument $document, ?User $actor, string $reason): void
    {
        $application = $document->loadMissing('application')->application;
        $facts = Contacts::facts($application);
        $url = Contacts::url($application);
        $initials = self::initials($actor, $application);
        $subject = self::line($facts, Status::UPDATE_REQUIRED, $actor, $initials);
        $reason = trim($reason);
        $sentBack = [['label' => $document->label, 'reason' => $reason !== '' ? $reason : null]];

        self::fanOut(
            $application,
            fn (?string $name) => Postcards::cipUpdatesRequired($facts, $sentBack, $actor, $url, $name, $subject),
            self::template(Status::UPDATE_REQUIRED),
            self::bellType(Status::UPDATE_REQUIRED),
            $actor,
            $facts['number'].': '.Status::label(Status::UPDATE_REQUIRED),
            $document->label.' was sent back'.($reason !== '' ? ': '.Str::limit($reason, 140) : '.'),
        );
    }

    /**
     * A comment on a checklist document, to everyone on the application.
     *
     * §13's thread exists so the provider side can be told what is wrong
     * and answer; a reply nobody is told about is a note left in a drawer.
     * Everyone but the author: the same §22 list a status change writes to.
     */
    public static function documentComment(CipDocument $document, User $author, string $body): void
    {
        $application = $document->loadMissing('application')->application;
        $facts = Contacts::facts($application);
        $url = Contacts::url($application);
        $title = $author->name.' commented on '.$document->label.' ('.$facts['number'].')';
        $message = Str::limit(trim($body), 140);

        self::fanOut(
            $application,
            fn (?string $name) => Postcards::notification(
                $title, $message, $url, 'Open the documents',
                $name ? (strtok($name, ' ') ?: $name) : null, 'CIP Applications',
            ),
            'cip-comment',
            'cip.comment',
            $author,
            $title,
            $message,
            $author->email,
        );
    }

    /**
     * The one delivery loop every CIP notice walks.
     *
     * A postcard to every §22 mailbox, built per recipient so the greeting
     * carries their name, and a bell for the ones with a portal account. The
     * bell goes with the email channel off, so the Notifier cannot send a
     * second, differently-worded copy of the same fact.
     *
     * @param  callable(?string): Postcard  $card
     */
    private static function fanOut(
        CipApplication $application,
        callable $card,
        string $template,
        string $type,
        ?User $actor,
        string $title,
        string $message,
        ?string $skipMailbox = null,
    ): void {
        $path = Contacts::path($application);

        foreach (Contacts::notices($application) as $recipient) {
            if ($skipMailbox !== null && mb_strtolower($recipient['email']) === mb_strtolower($skipMailbox)) {
                continue;
            }

            // Queue: a status click must not wait on the mailbox. Walking
            // Assessment feedback then Updates Required would otherwise send
            // eight letters before the chip could move.
            Deliveries::send($card($recipient['name']), $recipient['email'], $application, $template);

            if ($recipient['userId'] === null) {
                continue;
            }

            Notifier::send([
                'user' => User::find($recipient['userId']),
                'actor' => $actor,
                'type' => $type,
                'title' => $title,
                'message' => $message,
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

        $letter = in_array($to, [Status::GRANTED, Status::DENIED], true)
            ? $application->decisionLetterFile
            : null;

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
                $letter,
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
