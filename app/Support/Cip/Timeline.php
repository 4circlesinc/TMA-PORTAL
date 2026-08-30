<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Calendar\CalendarAudit;
use App\Support\Companies\ContactIdentity;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * One application's history, in English, what the Activity tab reads from.
 *
 * cip_events is written for the auditor: an action slug, two status codes and
 * a bag of meta. "status_changed / review_application" is not a line anybody
 * wants on a screen, so this is the one place that turns a row into a sentence,
 * and the one place that decides what an action nobody has met before reads
 * like. The table grows an action or two every phase; a row this file cannot
 * name must still produce a line, because a blank in an audit trail is worse
 * than an awkward sentence.
 *
 * The vocabularies stay where they belong: an application's statuses are read
 * through {@see Status} and a slot's through {@see DocumentStatus}, so a
 * wording changed in either shows up here without an edit. Sibling to
 * {@see CalendarAudit::describe()}, which does the same job for a calendar's
 * history, the two should read alike.
 */
class Timeline
{
    /** The most entries one read answers with, whatever it is asked for. */
    public const MAX_LIMIT = 500;

    /**
     * The application's history, newest first.
     *
     * @return list<array{
     *     id:int, action:string, when:string|null,
     *     who:array{name:string, avatar:string|null}, what:string
     * }>
     */
    public static function for(CipApplication $application, User $viewer, int $limit = 100): array
    {
        /*
         * Scoped, though the caller has usually resolved the application
         * already.
         *
         * A history is the most detailed thing the module holds about a file —
         * who worked it, when, and what they judged, and a caller written
         * after this one must not be able to hand over an application object
         * and have it read out. Nothing, rather than an error: it is the same
         * answer the reader would be given anyway, and it costs one exists().
         */
        if (! ApplicationScope::query($viewer)->whereKey($application->getKey())->exists()) {
            return [];
        }

        $events = $application->events()
            /*
             * Eager, and including binned accounts.
             *
             * A hundred events must not be a hundred user lookups. Trashed
             * matters as much: an account in the Recycle Bin still belongs to
             * the person who made the decision, and without this their name
             * falls back to the system, a machine credited with somebody's
             * judgement, in the one record kept for compliance.
             *
             * companyMember is the other half: a purged login leaves actor_id
             * null, and the membership is what still names the contact.
             */
            ->with(['actor', 'companyMember'])
            // The id breaks the tie, and has to: an assignment and the status
            // change it causes are written in one transaction and share a
            // timestamp to the second.
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(max(1, min($limit, self::MAX_LIMIT)))
            ->get();

        $documents = self::documentLabels($events);

        return $events->map(function (CipEvent $event) use ($documents) {
            $who = self::who($event);

            return [
                'id' => $event->id,
                // The raw action travels with the sentence so the tab can pick
                // an icon without parsing English back into a code.
                'action' => $event->action,
                'when' => $event->created_at?->toIso8601String(),
                'who' => $who,
                'what' => self::sentence($event, $who['name'], $documents),
            ];
        })->all();
    }

    /**
     * Who acted, as the tab draws them.
     *
     * A null actor_id with no membership and no stored name is the system, a
     * scheduled job, or a link upload nobody was signed in for. A contact
     * whose login has been purged is named from the membership, then from
     * the name written on the row when it happened — never as the system.
     *
     * @return array{name:string, avatar:string|null}
     */
    private static function who(CipEvent $event): array
    {
        $actor = $event->actor;
        $member = $event->companyMember;
        $drawn = ContactIdentity::present($actor, $member, $event->actor_name);

        $system = $event->actor_id === null
            && $event->company_member_id === null
            && ($event->actor_name === null || $event->actor_name === '');

        return [
            'name' => $system ? 'the system' : $drawn['name'],
            'avatar' => $drawn['avatar'],
        ];
    }

    /**
     * One event as a line a person can read.
     *
     * Built lower-case and capitalised at the end, which is what lets "the
     * system" be the subject of a sentence without pretending to be a name.
     *
     * @param  array<string, string>  $documents  uuid => label
     */
    private static function sentence(CipEvent $event, string $who, array $documents): string
    {
        $meta = $event->meta ?? [];

        $line = match ($event->action) {
            CipEvent::ACTION_CREATED => "{$who} filed the application",
            CipEvent::ACTION_STATUS_CHANGED => self::statusSentence($event, $who),
            CipEvent::ACTION_ASSIGNED => "{$who} assigned ".($meta['officer'] ?? 'an officer'),
            CipEvent::ACTION_UNASSIGNED => "{$who} ended ".($meta['officer'] ?? 'an officer').'’s assignment',
            CipEvent::ACTION_NUMBER_ASSIGNED => self::numberSentence($meta, $who),
            CipEvent::ACTION_DECISION_RECORDED => self::decisionSentence($meta, $who),
            CipEvent::ACTION_PACKAGE_CONFIRMED => "{$who} confirmed the submission package",
            CipEvent::ACTION_COR_PACKAGE_CONFIRMED => "{$who} confirmed the Certificate of Registration package",
            CipEvent::ACTION_COR_SUBMITTED => self::stageSentence($meta, $who, 'recorded the COR submission'),
            CipEvent::ACTION_COR_RECEIVED => self::stageSentence($meta, $who, 'recorded the COR received'),
            CipEvent::ACTION_NIC_SUBMITTED => self::stageSentence($meta, $who, 'recorded the NIC submission'),
            CipEvent::ACTION_NIC_RECEIVED => self::stageSentence($meta, $who, 'recorded the NIC received'),
            CipEvent::ACTION_PASSPORT_SUBMITTED => self::stageSentence($meta, $who, 'recorded the passport application'),
            CipEvent::ACTION_PASSPORT_RECEIVED => self::stageSentence($meta, $who, 'recorded the passport received'),
            CipEvent::ACTION_PASSPORT_DELIVERED => self::stageSentence($meta, $who, 'recorded the passport delivered'),
            CipEvent::ACTION_QUERY_RECEIVED => self::querySentence($meta, $who),
            CipEvent::ACTION_ACCEPTED_FOR_PROCESSING => self::acceptedSentence($meta, $who),
            CipEvent::ACTION_MILESTONE_CORRECTED => self::milestoneSentence($meta, $who),
            CipEvent::ACTION_DELAYED => self::delayedSentence($meta, $who),
            CipEvent::ACTION_POST_APPROVAL_ENTERED => "{$who} started the post-approval process (Certificate of Registration)",
            DocumentEngine::ACTION_STATUS_CHANGED => self::documentSentence($meta, $who, $documents),
            /*
             * An action added to the table after this file was written.
             *
             * Passive, and read off the slug itself: every action cip_events
             * holds today comes out right that way, "status changed by Ada
             * Admin", "number assigned by the system", which is the best
             * evidence available that the next one will too. The alternative
             * is a row that appears in the history saying nothing.
             */
            default => str_replace('_', ' ', $event->action)." by {$who}",
        };

        // Multibyte-aware, so a name that opens on an accented letter is not
        // mangled into two characters on its way to being capitalised.
        return Str::ucfirst($line);
    }

    /** "moved it from Draft to New", the codes read through {@see Status}. */
    private static function statusSentence(CipEvent $event, string $who): string
    {
        $to = $event->to_status;

        // Nothing writes a status change without a destination, but a row that
        // says something happened must not come out blank because of it.
        if ($to === null) {
            return "{$who} changed the status";
        }

        return $event->from_status === null
            ? "{$who} moved it to ".Status::label($to)
            : "{$who} moved it from ".Status::label($event->from_status).' to '.Status::label($to);
    }

    /**
     * The government's number arriving, or being corrected.
     *
     * Told apart by the meta {@see Submission} writes, a correction carries
     * what the number was before. Both are the same action on purpose (§7), so
     * without this a typo being fixed would read as a second submission.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function numberSentence(array $meta, string $who): string
    {
        $number = $meta['cipNumber'] ?? null;

        if ($number === null) {
            return "{$who} recorded the CIP number";
        }

        return isset($meta['previous'])
            ? "{$who} corrected the CIP number to {$number}"
            : "{$who} recorded the CIP number {$number}";
    }

    /**
     * The Unit's decision, named as the status chip names it, and by the day.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function decisionSentence(array $meta, string $who): string
    {
        $decision = $meta['decision'] ?? null;
        $date = $meta['decidedAt'] ?? null;
        $outcome = ($decision !== null && Status::isTerminal($decision))
            ? Status::label($decision)
            : null;

        if ($outcome && $date) {
            return "{$who} recorded the decision: {$outcome} on {$date}";
        }

        if ($outcome) {
            return "{$who} recorded the decision: {$outcome}";
        }

        return $date
            ? "{$who} recorded the decision on {$date}"
            : "{$who} recorded the decision";
    }

    /**
     * A milestone date corrected: which step, to what, and from what.
     *
     * What it said before is the point of the line. A date silently different
     * from the one on last month's report is the thing an audit is trying to
     * catch, so the sentence carries both days rather than only the new one.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function milestoneSentence(array $meta, string $who): string
    {
        $label = $meta['label'] ?? null;
        $step = $label !== null ? lcfirst((string) $label).' date' : 'a milestone date';
        $date = $meta['date'] ?? null;
        $previous = $meta['previous'] ?? null;

        if ($date === null) {
            return "{$who} corrected the {$step}";
        }

        return $previous !== null
            ? "{$who} corrected the {$step} from {$previous} to {$date}"
            : "{$who} corrected the {$step} to {$date}";
    }

    /**
     * A post-approval date the Unit or the firm recorded.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function stageSentence(array $meta, string $who, string $verb): string
    {
        $date = $meta['date'] ?? null;

        return $date
            ? "{$who} {$verb} on {$date}"
            : "{$who} {$verb}";
    }

    /**
     * The Unit's query, named by the day it arrived.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function querySentence(array $meta, string $who): string
    {
        $date = $meta['queryReceivedAt'] ?? null;

        return $date
            ? "{$who} recorded a query received on {$date}"
            : "{$who} recorded a query received from the Unit";
    }

    /**
     * The Unit accepted the file, named by the day it did.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function acceptedSentence(array $meta, string $who): string
    {
        $date = $meta['acceptedAt'] ?? null;

        return $date
            ? "{$who} recorded acceptance for processing on {$date}"
            : "{$who} recorded acceptance for processing";
    }

    /**
     * The delay clock running out, usually the system, named by how long.
     *
     * @param  array<string, mixed>  $meta
     */
    private static function delayedSentence(array $meta, string $who): string
    {
        $days = $meta['days'] ?? Delay::DAYS;

        return "{$who} marked it delayed after {$days} days with no decision";
    }

    /**
     * A checklist verdict, named by the document rather than by its uuid.
     *
     * {@see DocumentEngine} puts the slot's uuid and both of its statuses in
     * the meta and nothing else, the label lives on the slot, which is why
     * {@see documentLabels()} goes and gets it. A slot since removed leaves the
     * sentence standing without one.
     *
     * @param  array<string, mixed>  $meta
     * @param  array<string, string>  $documents  uuid => label
     */
    private static function documentSentence(array $meta, string $who, array $documents): string
    {
        $label = $documents[$meta['document'] ?? ''] ?? 'a document';
        $to = $meta['toStatus'] ?? null;

        if ($to === null) {
            return "{$who} changed {$label}";
        }

        $reason = trim((string) ($meta['note'] ?? ''));

        return match ($to) {
            DocumentStatus::UPDATE_REQUIRED => $reason !== ''
                ? "{$who} sent back {$label}: {$reason}"
                : "{$who} sent back {$label}",
            DocumentStatus::READY_FOR_SUBMISSION => "{$who} approved {$label}",
            // The only way into review is a file arriving: both edges the
            // engine allows into it come from an upload.
            DocumentStatus::APPLICATION_REVIEW => "{$who} uploaded {$label}",
            default => "{$who} moved {$label} to ".DocumentStatus::label($to),
        };
    }

    /**
     * uuid => label for every document this run of events names.
     *
     * One query for the lot rather than one per line, the same rule as the
     * actors. Trashed slots included: a requirement dropped from the checklist
     * last month does not stop the trail having to say which document was sent
     * back.
     *
     * @param  Collection<int, CipEvent>  $events
     * @return array<string, string>
     */
    private static function documentLabels(Collection $events): array
    {
        $uuids = $events
            ->filter(fn (CipEvent $e) => $e->action === DocumentEngine::ACTION_STATUS_CHANGED)
            ->map(fn (CipEvent $e) => $e->meta['document'] ?? null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($uuids === []) {
            return [];
        }

        return CipDocument::withTrashed()
            ->whereIn('uuid', $uuids)
            ->pluck('label', 'uuid')
            ->all();
    }
}
