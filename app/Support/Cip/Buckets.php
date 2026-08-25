<?php

namespace App\Support\Cip;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * §9's action-driven dashboards: what this reader should pick up today, and
 * how much of it there is.
 *
 * A bucket is one definition read twice. {@see self::for()} counts it and
 * {@see self::apply()} narrows the listing to it, so the chip and the table
 * behind it cannot disagree. A chip saying eleven that opens onto nine rows is
 * worse than no chip at all: it is the dashboard telling somebody there is
 * work they then cannot find.
 *
 * WHICH BUCKETS ARE PERSONAL, AND WHICH ARE THE WHOLE SLICE
 *
 * The administrator's ten and the service provider's six are reports. They
 * count everything the reader may see, and what that is has already been
 * decided by {@see ApplicationScope}, every application for an administrator,
 * one provider firm's book for a contact there, one applicant's own record for
 * a private client. Nobody's name is in the query.
 *
 * The Reviewing Officer's and Compliance Officer's four are work queues.
 * They count only the files that officer holds, which is why they are scoped
 * to that person rather than to a status alone. That distinction is the
 * difference between "how much work is there" and "how much of it is mine",
 * and it is the reason the same status appears in both sets under different
 * names: Assessment feedback is a number on the administrator's report and a
 * task on the officer's list.
 *
 * NOTHING IS FILED AS A DRAFT
 *
 * Applications are born at NEW and land in the New Applications bucket. DRAFT
 * remains a leftover code, historical events, and any row that has not yet
 * been moved, and no set names it, so those leftovers still count nowhere.
 *
 * NOT CACHED, AND MUST NOT BE
 *
 * The dashboard-metrics pair keeps its cards warm for five minutes, which is
 * right for a rolling thirty-day average and wrong here. An officer who clears
 * a file and watches the count sit still concludes the portal is broken, so a
 * work queue that lags a status change reads as a bug however correct it is a
 * few minutes later. There is nothing to save either: the whole set costs one
 * grouped count.
 */
class Buckets
{
    /** Counted over everything the reader may see. */
    public const SCOPE_ALL = 'all';

    /** Counted over the applications this officer holds. */
    public const SCOPE_MINE = 'mine';

    /** §9's three sets, named as the brief names them. */
    public const ADMINISTRATOR = 'administrator';

    public const REVIEWING_OFFICER = 'reviewing_officer';

    public const SERVICE_PROVIDER = 'service_provider';

    /**
     * The statuses a file is under review in, what a reviewing officer's
     * queue is made of.
     *
     * It stops at Ready to submit on purpose. A file that has been approved
     * for submission has left the reviewer for compliance, and a decided one
     * has left everybody; counting either would pad the queue with work that
     * is finished.
     */
    private const UNDER_REVIEW = [
        Status::REVIEW_APPLICATION,
        Status::ASSESSMENT_FEEDBACK,
        Status::UPDATE_REQUIRED,
    ];

    /**
     * Every bucket the module has, defined once.
     *
     * Keyed rather than listed because two sets share six of them: the
     * administrator and the service provider are looking at the same six
     * statuses over different slices, and defining them twice is how the two
     * dashboards would drift apart the first time one status was renamed.
     *
     * @var array<string, array{label: string, statuses: list<string>, scope: string}>
     */
    private const DEFINITIONS = [
        'new' => [
            'label' => 'New Applications',
            'statuses' => [Status::NEW],
            'scope' => self::SCOPE_ALL,
        ],
        'review_application' => [
            'label' => 'Review Applications',
            'statuses' => [Status::REVIEW_APPLICATION],
            'scope' => self::SCOPE_ALL,
        ],
        'assessment_feedback' => [
            'label' => 'Assessment Feedback',
            'statuses' => [Status::ASSESSMENT_FEEDBACK],
            'scope' => self::SCOPE_ALL,
        ],
        'update_required' => [
            'label' => 'Updates Required',
            'statuses' => [Status::UPDATE_REQUIRED],
            'scope' => self::SCOPE_ALL,
        ],
        'ready_to_submit' => [
            'label' => 'Ready to Submit',
            'statuses' => [Status::READY_TO_SUBMIT],
            'scope' => self::SCOPE_ALL,
        ],
        'pending_review' => [
            'label' => 'Pending Review',
            'statuses' => [Status::PENDING_REVIEW],
            'scope' => self::SCOPE_ALL,
        ],
        'background_check' => [
            'label' => 'Background Check',
            'statuses' => [Status::BACKGROUND_CHECK],
            'scope' => self::SCOPE_ALL,
        ],
        'delayed' => [
            'label' => 'Delayed',
            'statuses' => [Status::DELAYED],
            'scope' => self::SCOPE_ALL,
        ],
        /*
         * §9's dashboards say "Approved" and the engine stores GRANTED; they
         * are the same applications. Status::label() is "Approved" too, so the
         * chip on the row and this bucket cannot disagree.
         */
        'approved' => [
            'label' => 'Approved',
            'statuses' => [Status::GRANTED],
            'scope' => self::SCOPE_ALL,
        ],
        'denied' => [
            'label' => 'Denied',
            'statuses' => [Status::DENIED],
            'scope' => self::SCOPE_ALL,
        ],

        /* The Reviewing Officer's queues, every one of them personal. */

        // The officer's whole desk, and deliberately the sum of the three
        // below: a total beside its parts is what tells them whether the day
        // is heavy before they read which kind of heavy it is.
        'assigned_reviews' => [
            'label' => 'Assigned Reviews',
            'statuses' => self::UNDER_REVIEW,
            'scope' => self::SCOPE_MINE,
        ],
        // Handed over and not yet read.
        'reviews_pending' => [
            'label' => 'Reviews Pending',
            'statuses' => [Status::REVIEW_APPLICATION],
            'scope' => self::SCOPE_MINE,
        ],
        // Read, and waiting on the officer's verdict to move.
        'assessment_feedback_tasks' => [
            'label' => 'Assessment Feedback Tasks',
            'statuses' => [Status::ASSESSMENT_FEEDBACK],
            'scope' => self::SCOPE_MINE,
        ],
        // Sent back, and waiting on the provider side. Still the officer's to
        // watch: an update nobody chases is the round trip §14 measures.
        'information_requests' => [
            'label' => 'Additional Information Requests',
            'statuses' => [Status::UPDATE_REQUIRED],
            'scope' => self::SCOPE_MINE,
        ],
    ];

    /**
     * Which buckets each dashboard shows, in the order §9 lists them, the
     * order is part of the brief, not a detail for a renderer to choose.
     *
     * @var array<string, list<string>>
     */
    private const SETS = [
        self::ADMINISTRATOR => [
            'new', 'review_application', 'assessment_feedback', 'update_required',
            'ready_to_submit', 'pending_review', 'background_check', 'delayed',
            'approved', 'denied',
        ],
        self::REVIEWING_OFFICER => [
            'assigned_reviews', 'reviews_pending', 'assessment_feedback_tasks',
            'information_requests',
        ],
        self::SERVICE_PROVIDER => [
            'update_required', 'ready_to_submit', 'pending_review', 'delayed',
            'approved', 'denied',
        ],
    ];

    /**
     * Which of §9's dashboards this reader gets, or null for somebody the
     * module is not for.
     */
    public static function setFor(?User $user): ?string
    {
        if ($user === null || ! CipAccess::canReach($user)) {
            return null;
        }

        if (Role::isAdmin($user)) {
            return self::ADMINISTRATOR;
        }

        if (CipAccess::isOfficer($user, CipAccess::REVIEWING_OFFICER)
            || CipAccess::isOfficer($user, CipAccess::COMPLIANCE_OFFICER)) {
            return self::REVIEWING_OFFICER;
        }

        // A Service Provider contact or a Private Client: the same
        // applicant-facing six, because ApplicationScope has already decided
        // how much of the world each of them sees. A private client is the
        // same reader with a slice of one.
        return self::SERVICE_PROVIDER;
    }

    /**
     * This reader's dashboard: every bucket with its count and the filter that
     * reproduces it.
     *
     * @return list<array{key: string, label: string, count: int, statuses: list<string>, scope: string, tone: string, filter: array<string, string>}>
     */
    public static function for(?User $user): array
    {
        return self::summary($user)['buckets'];
    }

    /**
     * The same buckets, and how many applications they cover between them.
     *
     * THE TOTAL IS A UNION, NOT A SUM
     *
     * Adding the bucket counts up would be wrong on one of the three sets and
     * the wrongness would be invisible: the Reviewing Officer's Assigned
     * Reviews is *deliberately* the sum of the three queues under it, so a
     * naive total reports every file on that officer's desk twice. It is
     * counted over the distinct statuses the set covers instead — within each
     * scope, because a personal queue and a firm-wide report count different
     * rows — so a status named by two buckets still contributes once.
     *
     * What it therefore means is "applications this dashboard is about": the
     * whole book for an administrator, the firm's book for a provider contact,
     * this officer's desk for a reviewer. It is not a pipeline figure — the
     * administrator's ten include Approved and Denied, which have left the
     * pipeline — so nothing that draws it may call it one.
     *
     * Free: the tallies are already in hand, so no extra query is asked.
     *
     * @return array{buckets: list<array{key: string, label: string, count: int, statuses: list<string>, scope: string, tone: string, filter: array<string, string>}>, total: int}
     */
    public static function summary(?User $user): array
    {
        $set = self::setFor($user);

        if ($set === null || $user === null) {
            return ['buckets' => [], 'total' => 0];
        }

        $buckets = [];
        $tallies = [];
        // Keyed by scope and status, so the same status reached through two
        // buckets overwrites rather than adds.
        $covered = [];

        foreach (self::SETS[$set] as $key) {
            $definition = self::DEFINITIONS[$key];

            /*
             * One grouped count per scope, not one per bucket.
             *
             * Ten buckets over one slice is a single question, how many
             * applications sit at each status, and asking it ten times would
             * put ten round trips behind every dashboard load for numbers that
             * came out of the same rows. Keyed by scope because a personal
             * queue counts a different set of rows, so a set that mixes the
             * two costs one count each rather than one per bucket.
             */
            $tallies[$definition['scope']] ??= self::tally($user, $definition['scope']);
            $tally = $tallies[$definition['scope']];

            foreach ($definition['statuses'] as $status) {
                $covered[$definition['scope'].'|'.$status] = $tally[$status] ?? 0;
            }

            $buckets[] = [
                'key' => $key,
                'label' => $definition['label'],
                'count' => array_sum(array_map(
                    fn (string $status) => $tally[$status] ?? 0,
                    $definition['statuses'],
                )),
                // What the chip is counting, spelled out: a dashboard that
                // says "Assigned Reviews: 6" and cannot say which six states
                // that covers is asking the reader to take it on trust.
                'statuses' => $definition['statuses'],
                'scope' => $definition['scope'],
                // The colour this bucket is drawn in, wherever it is drawn.
                // The dashboard card and the listing's filter menu both read
                // it, so neither has to keep its own opinion about which
                // buckets are work and which are decisions.
                'tone' => self::tone($definition['statuses']),
                /*
                 * What to hand the applications listing to see these rows.
                 *
                 * The key and nothing else, on purpose. A filter spelled out
                 * as `status=` would work for the single-status buckets and
                 * silently lie for the officer queues, which are a person as
                 * well as a status, so the listing hands this straight back
                 * to {@see self::find()} and {@see self::apply()}, the same
                 * definition the count above was measured through.
                 */
                'filter' => ['bucket' => $key],
            ];
        }

        return ['buckets' => $buckets, 'total' => array_sum($covered)];
    }

    /**
     * One bucket of this reader's own dashboard, or null.
     *
     * Membership is checked, not just existence: a bucket that is not on this
     * reader's dashboard is not theirs to filter by, and answering with
     * somebody else's queue, even correctly scoped, so empty, would be the
     * listing offering a view nothing ever put in front of them.
     *
     * @return array{key: string, label: string, statuses: list<string>, scope: string}|null
     */
    public static function find(?User $user, string $key): ?array
    {
        $set = self::setFor($user);

        if ($set === null || ! in_array($key, self::SETS[$set], true)) {
            return null;
        }

        return ['key' => $key] + self::DEFINITIONS[$key];
    }

    /**
     * Narrow an application query to one bucket, the other half of the same
     * definition the count came from.
     *
     * Takes a query rather than building one so the caller keeps its own
     * eager loads, ordering and paging; it must already be scoped through
     * {@see ApplicationScope}, exactly as the count is.
     *
     * @param  array{statuses: list<string>, scope: string}  $bucket
     */
    public static function apply(Builder $query, array $bucket, User $user): Builder
    {
        return self::scoped($query, $bucket['scope'], $user)
            ->whereIn('status', $bucket['statuses']);
    }

    /**
     * The one tone a bucket is drawn in, borrowed from the statuses inside it.
     *
     * {@see Status::tone()} owns the mapping and this asks it rather than
     * restating it, for the same reason {@see self::apply()} shares a
     * definition with the count: a bucket whose dot said one thing and whose
     * rows all wore a chip saying another would be two answers to "what kind
     * of work is this", and the reader has no way to tell which is the real
     * one. Sixteen of the seventeen buckets cover a single status and simply
     * take its tone.
     *
     * THE MULTI-STATUS ONE
     *
     * Only the Reviewing Officer's Assigned Reviews covers several, the three
     * states of {@see self::UNDER_REVIEW}, and a dot can only be one colour,
     * so it takes the tone of the first status in the definition. That is the
     * state the queue is named for and the one work enters it at, and the tone
     * is describing what kind of bucket this is rather than how the files in
     * it are doing: a total that turned red because one of six went
     * non-compliant would be reporting a single row's state as the whole
     * queue's, on a number whose entire job is to say how much there is.
     *
     * The three statuses in UNDER_REVIEW now wear three colours, so this
     * rule is the one that settles the disagreement: Assigned Reviews is
     * indigo because it is named for REVIEW APPLICATION, not because the
     * files inside it have stopped being different colours.
     *
     * @param  list<string>  $statuses
     */
    private static function tone(array $statuses): string
    {
        return Status::tone($statuses[0]);
    }

    /**
     * The scope half: everything the reader may see, or only what they hold.
     *
     * A Reviewing Officer is usually the cache column, and a Compliance
     * Officer is not: {@see Assignments::refreshCache} writes the reviewer
     * into assigned_officer_id when a file is held in both jobs. The live
     * assignment is the authority for either role, so "mine" is whoever holds
     * the file now, not whoever the listing column happens to name. The cache
     * is still matched so a fixture that only filled the column, and a queue
     * that used to read only that column, keeps counting the same rows.
     */
    private static function scoped(Builder $query, string $scope, User $user): Builder
    {
        if ($scope !== self::SCOPE_MINE) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->where('cip_applications.assigned_officer_id', $user->id)
                ->orWhereHas(
                    'assignments',
                    fn (Builder $a) => $a->live()->where('user_id', $user->id),
                );
        });
    }

    /**
     * How many applications sit at each status, within one scope.
     *
     * Aggregated in the database, like {@see Review::tally}: the dashboard
     * needs a dozen numbers, and fetching the rows to count them would be a
     * firm's whole book loaded to answer them.
     *
     * @return array<string, int>
     */
    private static function tally(User $user, string $scope): array
    {
        $tally = [];

        $rows = self::scoped(ApplicationScope::query($user), $scope, $user)
            ->selectRaw('status, COUNT(*) as total')
            ->groupBy('status')
            ->get();

        foreach ($rows as $row) {
            $tally[$row->status] = (int) $row->total;
        }

        return $tally;
    }
}
