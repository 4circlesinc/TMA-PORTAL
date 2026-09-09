<?php

namespace App\Support\Cip;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipPersonChangeRequest;
use App\Models\User;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use App\Support\Signatures\Presenter as SignaturePresenter;
use Illuminate\Support\Str;

/**
 * Section 22, one subject format, one recipient list, every status change.
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
     * Tell every section 22 recipient that this application now stands at `$to`.
     *
     * Called from {@see Engine::write} after the row and the event have both
     * landed, so nothing is announced that did not occur.
     */
    public static function announce(
        CipApplication $application,
        string $to,
        ?User $actor,
        ?string $message = null,
    ): void {
        if ($to === Status::DRAFT) {
            return;
        }

        $facts = Contacts::facts($application);
        $path = Contacts::path($application, $to);
        $url = rtrim(config('app.url'), '/').$path;
        $initials = self::initials($actor, $application);

        self::fanOut(
            $application,
            fn (?string $name) => self::postcard($application, $facts, $to, $url, $actor, $initials, $name, $message),
            self::template($to),
            self::bellType($to),
            $actor,
            $facts['number'].': '.Status::label($to),
            self::bellMessage($application, $to, $facts),
            path: $path,
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
     * Section 13's thread exists so the provider side can be told what is wrong
     * and answer; a reply nobody is told about is a note left in a drawer.
     * Everyone but the author: the same section 22 list a status change writes to.
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
     * The provider side has asked the firm to appeal a decision.
     *
     * Addressed to the same section 22 list as everything else on this file, minus
     * the person who asked — they know. It is a request, not a status change,
     * so it says who wants what and leaves the lodging to whoever reads it.
     */
    public static function appealRequested(CipApplication $application, User $author, ?string $reason): void
    {
        $facts = Contacts::facts($application);
        $url = Contacts::url($application);
        $title = $facts['number'].': appeal requested';
        $message = trim((string) $reason) !== ''
            ? Str::limit(trim((string) $reason), 140)
            : $author->name.' asked the firm to appeal this decision.';

        self::fanOut(
            $application,
            fn (?string $name) => Postcards::notification(
                $title, $message, $url, 'Open the application',
                $name ? (strtok($name, ' ') ?: $name) : null, 'CIP Applications',
            ),
            'cip-appeal-requested',
            'cip.appeal-requested',
            $author,
            $title,
            $message,
            $author->email,
        );
    }

    /**
     * Somebody has asked to correct a person on a post-approval file.
     *
     * Goes to the administrators, because they are the only ones who can
     * answer it. The other section 22 classes are not told: a proposal that may
     * be declined is not news about the file, and telling the provider side
     * about a correction the firm has not accepted yet would be.
     */
    public static function personChangeRequested(
        CipApplication $application,
        CipPerson $person,
        User $author,
        CipPersonChangeRequest $request,
    ): void {
        $facts = Contacts::facts($application);
        $url = Contacts::url($application);
        $who = trim(($person->first_name ?? '').' '.($person->last_name ?? '')) ?: 'somebody on the file';
        $title = $facts['number'].': change requested for '.$who;
        $fields = implode(', ', array_keys(PersonEdits::describe($request)));
        $message = $author->name.' asked to change '.($fields !== '' ? $fields : 'these details').'.';

        foreach (Contacts::administrators() as $admin) {
            if (mb_strtolower($admin['email']) === mb_strtolower((string) $author->email)) {
                continue;
            }

            Deliveries::send(
                Postcards::notification(
                    $title, $message, $url, 'Review the request',
                    $admin['name'] ? (strtok($admin['name'], ' ') ?: $admin['name']) : null,
                    'CIP Applications',
                ),
                $admin['email'],
                $application,
                'cip-person-change',
            );

            if ($admin['userId'] === null) {
                continue;
            }

            Notifier::send([
                'user' => User::find($admin['userId']),
                'actor' => $author,
                'type' => 'cip.person-change',
                'title' => $title,
                'message' => $message,
                'subject' => $application,
                'action_url' => Contacts::path($application),
                'email' => false,
            ]);
        }
    }

    /** The answer, to whoever asked. */
    public static function personChangeDecided(CipPersonChangeRequest $request, User $actor): void
    {
        $application = $request->application;
        $requester = $request->requester;

        if ($application === null || $requester === null || $requester->id === $actor->id) {
            return;
        }

        $facts = Contacts::facts($application);
        $approved = $request->status === CipPersonChangeRequest::STATUS_APPROVED;
        $title = $facts['number'].': change '.($approved ? 'approved' : 'declined');
        $message = trim((string) $request->decision_note) !== ''
            ? trim((string) $request->decision_note)
            : ($approved
                ? 'Your correction has been applied.'
                : 'Your correction was not applied.');

        Deliveries::send(
            Postcards::notification(
                $title, $message, Contacts::url($application), 'Open the application',
                strtok($requester->name, ' ') ?: $requester->name,
                'CIP Applications',
            ),
            $requester->email,
            $application,
            'cip-person-change',
        );

        Notifier::send([
            'user' => $requester,
            'actor' => $actor,
            'type' => 'cip.person-change',
            'title' => $title,
            'message' => $message,
            'subject' => $application,
            'action_url' => Contacts::path($application),
            'email' => false,
        ]);
    }

    /**
     * The one delivery loop every CIP notice walks.
     *
     * A postcard to every section 22 mailbox, built per recipient so the greeting
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
        ?string $path = null,
    ): void {
        $path ??= Contacts::path($application);

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
        ?string $message = null,
    ): Postcard {
        $subject = self::line($facts, $to, $actor, $initials);

        $letter = Status::isOutcome($to)
            ? $application->decisionLetterFile
            : null;

        return match ($to) {
            Status::UPDATE_REQUIRED => Postcards::cipUpdatesRequired(
                $facts, self::sentBack($application), $actor, $url, $recipientName, $subject,
            ),
            Status::READY_TO_SUBMIT => Postcards::cipReadyToSubmit($facts, $url, $recipientName, $subject),
            Status::APPLY_FOR_COR => Postcards::cipApplyForCor($facts, $url, $recipientName, $subject),
            Status::NON_COMPLIANT => Postcards::cipNonCompliant(
                $facts, $url, $application->query_received_at?->toDateString(), $recipientName, $actor, $subject,
                $message,
            ),
            Status::NEW_APPEAL => Postcards::cipAppeal(
                $facts, $url, $to, $application->appeal_lodged_at?->toDateString(),
                $recipientName, $actor, $subject, $message,
            ),
            Status::APPEAL_READY => Postcards::cipAppeal(
                $facts, $url, $to, null, $recipientName, $actor, $subject, $message,
            ),
            Status::APPEAL_SUBMITTED => Postcards::cipAppeal(
                $facts, $url, $to, $application->appeal_submitted_at?->toDateString(),
                $recipientName, $actor, $subject, $message,
            ),
            Status::BACKGROUND_CHECK => Postcards::cipBackgroundCheck(
                $facts, $url, $application->accepted_at?->toDateString(), $recipientName, $actor, $subject,
                $message,
            ),
            Status::DELAYED => Postcards::cipDelayed(
                $facts, $url, $application->accepted_at?->toDateString(), self::daysDelayed($application), $recipientName, $subject,
            ),
            Status::GRANTED, Status::DENIED, Status::POST_APPROVED, Status::POST_DENIED => Postcards::cipDecision(
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
        return Review::constrainToCurrentChecklist(
            CipDocument::query()->where('application_id', $application->id),
            $application->phase ?? Phase::PRE_APPROVAL,
            $application,
        )
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
            Status::APPLY_FOR_COR => 'cip-apply-for-cor',
            Status::NON_COMPLIANT => 'cip-non-compliant',
            Status::BACKGROUND_CHECK => 'cip-status-background-check',
            Status::DELAYED => 'cip-delayed',
            Status::GRANTED, Status::POST_APPROVED => 'cip-granted',
            Status::POST_APPROVAL => 'cip-status-post-approval',
            Status::DENIED, Status::POST_DENIED => 'cip-denied',
            Status::REVIEW_APPLICATION => 'cip-assigned',
            Status::NEW_APPEAL => 'cip-new-appeal',
            Status::APPEAL_READY => 'cip-appeal-ready',
            Status::APPEAL_SUBMITTED => 'cip-appeal-submitted',
            default => 'cip-status',
        };
    }

    private static function bellType(string $status): string
    {
        return match ($status) {
            Status::UPDATE_REQUIRED => 'cip.updates-required',
            Status::READY_TO_SUBMIT => 'cip.ready-to-submit',
            Status::APPLY_FOR_COR => 'cip.apply-for-cor',
            Status::NON_COMPLIANT => 'cip.non-compliant',
            Status::BACKGROUND_CHECK => 'cip.background-check',
            Status::DELAYED => 'cip.delayed',
            Status::GRANTED, Status::POST_APPROVED => 'cip.granted',
            Status::POST_APPROVAL => 'cip.post-approval',
            Status::DENIED, Status::POST_DENIED => 'cip.denied',
            Status::REVIEW_APPLICATION => 'cip.assigned',
            Status::NEW_APPEAL => 'cip.new-appeal',
            Status::APPEAL_READY => 'cip.appeal-ready',
            Status::APPEAL_SUBMITTED => 'cip.appeal-submitted',
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
            Status::APPLY_FOR_COR => 'Confirm submission to lock the Certificate of Registration package.',
            Status::NON_COMPLIANT => 'The Unit has requested additional information.',
            Status::BACKGROUND_CHECK => 'The Unit has accepted this file for processing. A background check is underway.',
            Status::DELAYED => self::daysDelayed($application).' days have passed since acceptance with no decision.',
            Status::GRANTED => 'The Unit has granted this application.',
            Status::POST_APPROVED => 'The post-approval application has been approved.',
            Status::POST_DENIED => 'The post-approval application has been denied.',
            Status::POST_APPROVAL => 'Stage 1 (Certificate of Registration) documents are now required. Soft copies only.',
            Status::APPLY_FOR_NIC => 'Stage 2 (National Insurance Card) documents are now required. Soft copies only, one PDF per person aged 16 and over.',
            Status::APPLY_FOR_PASSPORT => 'Stage 3 (passport) documents are now required. Hard copy originals only, sent to T.M. Antoine Partners by courier.',
            Status::PENDING_PASSPORT => 'The passport application has been submitted. The file now waits for the passport.',
            Status::READY_FOR_DELIVERY => 'The passport has been received and is ready for delivery.',
            Status::CLOSED => 'The passport has been delivered. This file is closed.',
            Status::DENIED => 'The Unit has denied this application.',
            default => $facts['applicant'].' now stands at '.Status::label($to).'.',
        };
    }
}
