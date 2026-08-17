<?php

namespace App\Support\Cip;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * §9's action-driven dashboards: what this reader should pick up today, and
 * how much of it there is.
 *
 * A bucket is one definition read twice — {@see self::for()} counts it and
 * {@see self::apply()} narrows the listing to it — so the chip and the table
 * behind it cannot disagree. A chip saying eleven that opens onto nine rows is
 * worse than no chip at all: it is the dashboard telling somebody there is
 * work they then cannot find.
 *
 * WHICH BUCKETS ARE PERSONAL, AND WHICH ARE THE WHOLE SLICE
 *
 * The administrator's ten and the service provider's six are reports. They
 * count everything the reader may see, and what that is has already been
 * decided by {@see ApplicationScope} — every application for an administrator,
 * one provider firm's book for a contact there, one applicant's own record for
 * a private client. Nobody's name is in the query.
 *
 * The Reviewing Officer's four are work queues. They count only the files that
 * officer holds, which is why they are scoped to assigned_officer_id rather
 * than to a status alone. That distinction is the difference between "how much
 * work is there" and "how much of it is mine", and it is the reason the same
 * status appears in both sets under different names: Assessment feedback is a
 * number on the administrator's report and a task on the officer's list.
 *
 * DRAFTS ARE IN NO BUCKET
 *
 * Deliberately, and by omission rather than by exclusion: no set names DRAFT,
 * so a half-written application counts nowhere. It belongs to the side writing
 * it (see {@see Status}), and putting it in front of an officer would be the
 * portal asking somebody to review a form nobody has finished.
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
     * The statuses a file is under review in — what a reviewing officer's
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
         * One bucket wearing two words.
         *
         * §9's dashboards say "Approved" and the decision workflow says
         * GRANTED; they are the same applications, so the label follows the
         * dashboard and the query follows the engine. Client question 1 asks
         * the firm which word users should see — when they answer, the label
         * on this line is the only thing that changes, because nothing counts
         * anything but Status::GRANTED.
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

        /* The Reviewing Officer's queues — every one of them personal. */

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
     * Which buckets each dashboard shows, in the order §9 lists them — the
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

        if (CipAccess::isOfficer($user, CipAccess::REVIEWING_OFFICER)) {
            return self::REVIEWING_OFFICER;
        }

        /*
         * The Compliance Officer reads the administrator's dashboard.
         *
         * §9 names three sets and none of them is theirs, and the honest
         * reading is that this is the one: their work is the tail of it —
         * Pending review, Background check, Delayed, and the two decisions —
         * over every application, which is exactly what these ten buckets
         * count. The officer queues cannot serve instead, because a personal
         * scope reads assigned_officer_id and that column caches the REVIEWING
         * officer (see {@see Assignments::refreshCache}); "mine" would quietly
         * be somebody else's. A fourth set is a question for the firm, not a
         * guess to make here.
         */
        if (CipAccess::isOfficer($user)) {
            return self::ADMINISTRATOR;
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
        $set = self::setFor($user);

        if ($set === null || $user === null) {
            return [];
        }

        $buckets = [];
        $tallies = [];

        foreach (self::SETS[$set] as $key) {
            $definition = self::DEFINITIONS[$key];

            /*
             * One grouped count per scope, not one per bucket.
             *
             * Ten buckets over one slice is a single question — how many
             * applications sit at each status — and asking it ten times would
             * put ten round trips behind every dashboard load for numbers that
             * came out of the same rows. Keyed by scope because a personal
             * queue counts a different set of rows, so a set that mixes the
             * two costs one count each rather than one per bucket.
             */
            $tallies[$definition['scope']] ??= self::tally($user, $definition['scope']);
            $tally = $tallies[$definition['scope']];

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
                 * well as a status — so the listing hands this straight back
                 * to {@see self::find()} and {@see self::apply()}, the same
                 * definition the count above was measured through.
                 */
                'filter' => ['bucket' => $key],
            ];
        }

        return $buckets;
    }

    /**
     * One bucket of this reader's own dashboard, or null.
     *
     * Membership is checked, not just existence: a bucket that is not on this
     * reader's dashboard is not theirs to filter by, and answering with
     * somebody else's queue — even correctly scoped, so empty — would be the
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
     * Narrow an application query to one bucket — the other half of the same
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
     * Only the Reviewing Officer's Assigned Reviews covers several — the three
     * states of {@see self::UNDER_REVIEW} — and a dot can only be one colour,
     * so it takes the tone of the first status in the definition. That is the
     * state the queue is named for and the one work enters it at, and the tone
     * is describing what kind of bucket this is rather than how the files in
     * it are doing: a total that turned red because one of six went
     * non-compliant would be reporting a single row's state as the whole
     * queue's, on a number whose entire job is to say how much there is.
     *
     * Nothing is being papered over yet. UNDER_REVIEW is unanimously 'action'
     * today, so the rule settles no live disagreement; it is written down here
     * to decide the first one, rather than leaving it to whichever status a
     * later edit happens to put first.
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
     * The cache column rather than a join through the assignments table.
     * {@see Assignments} keeps it in step with the live row and it sits on the
     * application being counted, so a queue is one predicate instead of a
     * subquery per dashboard.
     */
    private static function scoped(Builder $query, string $scope, User $user): Builder
    {
        return $scope === self::SCOPE_MINE
            ? $query->where('assigned_officer_id', $user->id)
            : $query;
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
