<?php

namespace App\Support\Cip;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * Section 9's action-driven dashboards: what this reader should pick up today, and
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
 * The administrator's pre-approval eleven and the service provider's seven are reports. They
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

    /** Section 9's three sets, named as the brief names them. */
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
     * Each carries a short name as well as the one section 9 gives it. That is not a
     * renderer's abbreviation to invent: "Additional Information Requests" and
     * "Assessment Feedback Tasks" have to fit a legend beside a chart, and a
     * browser shortening them by rule would be guessing where a name can be
     * cut. Named here, beside the label, so the two cannot drift apart.
     *
     * @var array<string, array{label: string, short: string, statuses: list<string>, scope: string}>
     */
    private const DEFINITIONS = [
        'new' => [
            'label' => 'New Applications',
            'short' => 'New',
            'statuses' => [Status::NEW],
            'scope' => self::SCOPE_ALL,
        ],
        'review_application' => [
            'label' => 'Review Applications',
            'short' => 'Review',
            'statuses' => [Status::REVIEW_APPLICATION],
            'scope' => self::SCOPE_ALL,
        ],
        'assessment_feedback' => [
            'label' => 'Assessment Feedback',
            'short' => 'Feedback',
            'statuses' => [Status::ASSESSMENT_FEEDBACK],
            'scope' => self::SCOPE_ALL,
        ],
        'update_required' => [
            'label' => 'Updates Required',
            'short' => 'Updates',
            'statuses' => [Status::UPDATE_REQUIRED],
            'scope' => self::SCOPE_ALL,
        ],
        'ready_to_submit' => [
            'label' => 'Ready to Submit',
            'short' => 'Ready',
            'statuses' => [Status::READY_TO_SUBMIT],
            'scope' => self::SCOPE_ALL,
        ],
        'pending_review' => [
            'label' => 'Pending Review',
            'short' => 'Pending',
            'statuses' => [Status::PENDING_REVIEW],
            'scope' => self::SCOPE_ALL,
        ],
        'non_compliant' => [
            'label' => 'Non-compliant',
            // 'Non-compliant' is 14 characters; the legend column holds 12.
            'short' => 'Non-comp',
            'statuses' => [Status::NON_COMPLIANT],
            'scope' => self::SCOPE_ALL,
        ],
        'background_check' => [
            'label' => 'Background Check',
            'short' => 'Background',
            'statuses' => [Status::BACKGROUND_CHECK],
            'scope' => self::SCOPE_ALL,
        ],
        'delayed' => [
            'label' => 'Delayed',
            'short' => 'Delayed',
            'statuses' => [Status::DELAYED],
            'scope' => self::SCOPE_ALL,
        ],
        /*
         * Section 9's dashboards say "Approved" and the engine stores GRANTED; they
         * are the same applications. Status::label() is "Approved" too, so the
         * chip on the row and this bucket cannot disagree.
         */
        'approved' => [
            'label' => 'Approved',
            'short' => 'Approved',
            'statuses' => [Status::GRANTED],
            'scope' => self::SCOPE_ALL,
        ],
        /*
         * The first post-approval status, not the whole lane. The dashboard
         * card now splits pre- and post-approval into two views, and the
         * post-approval view names each COR / NIC / passport stage so the
         * counts are the same vocabulary as the listing. CLOSED stays off
         * the card — a closed file is finished, and a waiting count that
         * never goes down teaches people to stop reading it.
         */
        'post_approval' => [
            'label' => 'Post-Approval',
            // 'Post-Approval' is 13 characters and the legend column holds
            // 12 — see the short-name test for why that budget exists.
            'short' => 'Post-App',
            'statuses' => [Status::POST_APPROVAL],
            'scope' => self::SCOPE_ALL,
        ],
        'apply_for_cor' => [
            'label' => 'Apply for COR',
            'short' => 'Apply COR',
            'statuses' => [Status::APPLY_FOR_COR],
            'scope' => self::SCOPE_ALL,
        ],
        'pending_cor' => [
            'label' => 'Pending COR',
            'short' => 'Pend. COR',
            'statuses' => [Status::PENDING_COR],
            'scope' => self::SCOPE_ALL,
        ],
        'apply_for_nic' => [
            'label' => 'Apply for NIC',
            'short' => 'Apply NIC',
            'statuses' => [Status::APPLY_FOR_NIC],
            'scope' => self::SCOPE_ALL,
        ],
        'pending_nic' => [
            'label' => 'Pending NIC',
            'short' => 'Pend. NIC',
            'statuses' => [Status::PENDING_NIC],
            'scope' => self::SCOPE_ALL,
        ],
        'apply_for_passport' => [
            'label' => 'Apply for Passport',
            'short' => 'Passport',
            'statuses' => [Status::APPLY_FOR_PASSPORT],
            'scope' => self::SCOPE_ALL,
        ],
        'pending_passport' => [
            'label' => 'Pending Passport',
            'short' => 'Pend. Pass',
            'statuses' => [Status::PENDING_PASSPORT],
            'scope' => self::SCOPE_ALL,
        ],
        'ready_for_delivery' => [
            'label' => 'Ready for Delivery',
            'short' => 'Delivery',
            'statuses' => [Status::READY_FOR_DELIVERY],
            'scope' => self::SCOPE_ALL,
        ],
        'denied' => [
            'label' => 'Denied',
            'short' => 'Denied',
            'statuses' => [Status::DENIED],
            'scope' => self::SCOPE_ALL,
        ],
        'post_approved' => [
            'label' => 'Approved',
            'short' => 'Approved',
            'statuses' => [Status::POST_APPROVED],
            'scope' => self::SCOPE_ALL,
        ],
        'post_denied' => [
            'label' => 'Denied',
            'short' => 'Denied',
            'statuses' => [Status::POST_DENIED],
            'scope' => self::SCOPE_ALL,
        ],

        /* The Reviewing Officer's queues, every one of them personal. */

        // The officer's whole desk, and deliberately the sum of the three
        // below: a total beside its parts is what tells them whether the day
        // is heavy before they read which kind of heavy it is.
        'assigned_reviews' => [
            'label' => 'Assigned Reviews',
            'short' => 'Assigned',
            'statuses' => self::UNDER_REVIEW,
            'scope' => self::SCOPE_MINE,
        ],
        // Handed over and not yet read.
        'reviews_pending' => [
            'label' => 'Reviews Pending',
            'short' => 'Pending',
            'statuses' => [Status::REVIEW_APPLICATION],
            'scope' => self::SCOPE_MINE,
        ],
        // Read, and waiting on the officer's verdict to move.
        'assessment_feedback_tasks' => [
            'label' => 'Assessment Feedback Tasks',
            'short' => 'Feedback',
            'statuses' => [Status::ASSESSMENT_FEEDBACK],
            'scope' => self::SCOPE_MINE,
        ],
        // Sent back, and waiting on the provider side. Still the officer's to
        // watch: an update nobody chases is the round trip section 14 measures.
        'information_requests' => [
            'label' => 'Additional Information Requests',
            'short' => 'Requests',
            'statuses' => [Status::UPDATE_REQUIRED],
            'scope' => self::SCOPE_MINE,
        ],
    ];

    /**
     * The post-approval pipeline, named stage by stage. Administrators and
     * provider contacts share it: ApplicationScope has already decided whose
     * book each of them is looking at. CLOSED is not on it, see post_approval.
     *
     * @var list<string>
     */
    private const POST_APPROVAL_PIPELINE = [
        'post_approval', 'apply_for_cor', 'pending_cor', 'apply_for_nic',
        'pending_nic', 'apply_for_passport', 'pending_passport',
        'ready_for_delivery', 'update_required', 'post_approved', 'post_denied',
    ];

    /**
     * Which buckets each dashboard shows, split by workflow lane.
     *
     * Pre-approval is section 9's report without the collapsed post-approval
     * chip — that lane has its own view now. Reviewing officers keep their
     * four personal queues on both sides; a file they hold that has moved
     * into post-approval is work on the post-approval card, not a leftover
     * on the pre-approval one.
     *
     * @var array<string, array<string, list<string>>>
     */
    private const PHASE_SETS = [
        Phase::PRE_APPROVAL => [
            self::ADMINISTRATOR => [
                'new', 'review_application', 'assessment_feedback', 'update_required',
                'ready_to_submit', 'pending_review', 'non_compliant', 'background_check',
                'delayed', 'approved', 'denied',
            ],
            self::REVIEWING_OFFICER => [
                'assigned_reviews', 'reviews_pending', 'assessment_feedback_tasks',
                'information_requests',
            ],
            self::SERVICE_PROVIDER => [
                'update_required', 'ready_to_submit', 'pending_review', 'non_compliant',
                'delayed', 'approved', 'denied',
            ],
        ],
        Phase::POST_APPROVAL => [
            self::ADMINISTRATOR => self::POST_APPROVAL_PIPELINE,
            self::REVIEWING_OFFICER => [
                'assigned_reviews', 'reviews_pending', 'assessment_feedback_tasks',
                'information_requests',
            ],
            self::SERVICE_PROVIDER => self::POST_APPROVAL_PIPELINE,
        ],
    ];

    /**
     * Which of section 9's dashboards this reader gets, or null for somebody the
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
        // applicant-facing set, because ApplicationScope has already decided
        // how much of the world each of them sees. A private client is the
        // same reader with a slice of one.
        return self::SERVICE_PROVIDER;
    }

    /**
     * The heading the home card uses for one lane.
     */
    public static function titleFor(string $phase): string
    {
        return Phase::label($phase).' Applications';
    }

    /**
     * The keys one dashboard names, in the order they are drawn.
     *
     * Passing a phase returns that lane's set. Passing none returns the
     * union, which is what {@see self::find()} uses: a bucket the reader
     * was offered on either card is theirs to filter by, even if they are
     * looking at the other lane when they press it.
     *
     * @return list<string>
     */
    public static function keysFor(string $set, ?string $phase = null): array
    {
        if ($phase !== null) {
            return self::PHASE_SETS[$phase][$set] ?? [];
        }

        $keys = [];

        foreach (self::PHASE_SETS as $phaseKeys) {
            foreach ($phaseKeys[$set] ?? [] as $key) {
                $keys[$key] = true;
            }
        }

        return array_keys($keys);
    }

    /**
     * This reader's dashboard: every bucket with its count and the filter that
     * reproduces it. Pre-approval, which is what the card opens on.
     *
     * @return list<array{key: string, label: string, short: string, count: int, statuses: list<string>, scope: string, tone: string, filter: array<string, string>, aggregate: bool, phase: string}>
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
     * administrator's pre-approval set includes Approved and Denied, which have
     * left the pipeline — so nothing that draws it may call it one.
     *
     * Free: the tallies are already in hand, so no extra query is asked.
     *
     * @return array{buckets: list<array{key: string, label: string, short: string, count: int, statuses: list<string>, scope: string, tone: string, filter: array<string, string>, aggregate: bool, phase: string}>, total: int}
     */
    public static function summary(?User $user, ?string $phase = null): array
    {
        $phase = ($phase !== null && Phase::isValid($phase)) ? $phase : Phase::PRE_APPROVAL;

        return self::summaries($user)[$phase];
    }

    /**
     * Both lanes, from one grouped count per scope.
     *
     * The home card draws one lane at a time and switches without asking
     * again, so both answers have to arrive together. Status and phase are
     * one GROUP BY, not two trips: the rows are the same ones either way.
     *
     * @return array<string, array{buckets: list<array{key: string, label: string, short: string, count: int, statuses: list<string>, scope: string, tone: string, filter: array<string, string>, aggregate: bool, phase: string}>, total: int}>
     */
    public static function summaries(?User $user): array
    {
        $empty = ['buckets' => [], 'total' => 0];
        $set = self::setFor($user);

        if ($set === null || $user === null) {
            return [
                Phase::PRE_APPROVAL => $empty,
                Phase::POST_APPROVAL => $empty,
            ];
        }

        $tallies = [];

        foreach ([Phase::PRE_APPROVAL, Phase::POST_APPROVAL] as $phase) {
            foreach (self::keysFor($set, $phase) as $key) {
                $scope = self::DEFINITIONS[$key]['scope'];
                $tallies[$scope] ??= self::tallyByPhase($user, $scope);
            }
        }

        return [
            Phase::PRE_APPROVAL => self::assemble($set, Phase::PRE_APPROVAL, $tallies),
            Phase::POST_APPROVAL => self::assemble($set, Phase::POST_APPROVAL, $tallies),
        ];
    }

    /**
     * One lane of one dashboard, from tallies already in hand.
     *
     * @param  array<string, array<string, array<string, int>>>  $tallies
     * @return array{buckets: list<array{key: string, label: string, short: string, count: int, statuses: list<string>, scope: string, tone: string, filter: array<string, string>, aggregate: bool, phase: string}>, total: int}
     */
    private static function assemble(string $set, string $phase, array $tallies): array
    {
        $buckets = [];
        // Keyed by scope and status, so the same status reached through two
        // buckets overwrites rather than adds.
        $covered = [];

        foreach (self::keysFor($set, $phase) as $key) {
            $definition = self::DEFINITIONS[$key];
            $tally = $tallies[$definition['scope']][$phase] ?? [];

            foreach ($definition['statuses'] as $status) {
                $covered[$definition['scope'].'|'.$status] = $tally[$status] ?? 0;
            }

            $buckets[] = [
                'key' => $key,
                'label' => $definition['label'],
                // The same name, short enough to sit in a legend. See
                // DEFINITIONS: it is named there, not abbreviated here.
                'short' => $definition['short'],
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
                 * The key and the lane. A filter spelled out as `status=`
                 * would work for the single-status buckets and silently lie
                 * for the officer queues, which are a person as well as a
                 * status, so the listing hands this straight back to
                 * {@see self::find()} and {@see self::apply()}, the same
                 * definition the count above was measured through. Phase is
                 * on it because Updates Required lives in both lanes, and
                 * without it the pre-approval card's count would open onto
                 * post-approval rows as well.
                 */
                'filter' => ['bucket' => $key, 'phase' => $phase],
                /*
                 * Whether this bucket is a roll-up of others in the same set
                 * rather than a slice of its own.
                 *
                 * True of exactly one bucket today: the Reviewing Officer's
                 * Assigned Reviews, which is deliberately the sum of the three
                 * queues under it. It is a fact about the *shape* of the set,
                 * so it is answered here rather than left to whoever draws it
                 * to work out from the statuses — and anything that shows the
                 * buckets as parts of a whole has to know. A chart that gave
                 * the roll-up a share alongside its own children would draw
                 * every file on that officer's desk twice and add up to 200%.
                 */
                'aggregate' => self::rollsUp($key, $set, $phase),
                'phase' => $phase,
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
     * A phase narrows membership to that lane's set. Without one, either
     * lane counts — the listing's Status menu and a typed URL both arrive
     * here, and a key the reader was offered on the other card is still
     * theirs.
     *
     * @return array{key: string, label: string, short: string, statuses: list<string>, scope: string, phase?: string}|null
     */
    public static function find(?User $user, string $key, ?string $phase = null): ?array
    {
        $set = self::setFor($user);

        if ($set === null || ! in_array($key, self::keysFor($set), true)) {
            return null;
        }

        $found = ['key' => $key] + self::DEFINITIONS[$key];
        $lane = ($phase !== null && Phase::isValid($phase)) ? $phase : null;

        // Attach the lane when this key is on that card, so Updates Required
        // counted pre-approval does not open post-approval rows. A leftover
        // filter from the other card is still a valid key (no 404) and is
        // left without a phase so the listing's own tab filter empties it.
        if ($lane !== null && in_array($key, self::keysFor($set, $lane), true)) {
            $found['phase'] = $lane;
        }

        return $found;
    }

    /**
     * Narrow an application query to one bucket, the other half of the same
     * definition the count came from.
     *
     * Takes a query rather than building one so the caller keeps its own
     * eager loads, ordering and paging; it must already be scoped through
     * {@see ApplicationScope}, exactly as the count is.
     *
     * @param  array{statuses: list<string>, scope: string, phase?: string}  $bucket
     */
    public static function apply(Builder $query, array $bucket, User $user): Builder
    {
        $query = self::scoped($query, $bucket['scope'], $user)
            ->whereIn('status', $bucket['statuses']);

        if (! empty($bucket['phase']) && Phase::isValid($bucket['phase'])) {
            $query->where('cip_applications.phase', $bucket['phase']);
        }

        return $query;
    }

    /**
     * Is this bucket a roll-up of others in its set?
     *
     * True when some *other* bucket in the set counts a proper subset of what
     * this one counts, within the same scope. The direction is the whole of
     * the rule: Assigned Reviews contains Reviews Pending, so Assigned Reviews
     * rolls up and Reviews Pending does not, and a test for mere overlap would
     * mark both and leave nothing to draw.
     */
    private static function rollsUp(string $key, string $set, string $phase): bool
    {
        $mine = self::DEFINITIONS[$key];

        foreach (self::keysFor($set, $phase) as $other) {
            if ($other === $key) {
                continue;
            }

            $theirs = self::DEFINITIONS[$other];

            if ($theirs['scope'] !== $mine['scope']) {
                continue;
            }

            if (count($theirs['statuses']) < count($mine['statuses'])
                && array_diff($theirs['statuses'], $mine['statuses']) === []) {
                return true;
            }
        }

        return false;
    }

    /**
     * The one tone a bucket is drawn in, borrowed from the statuses inside it.
     *
     * {@see Status::tone()} owns the mapping and this asks it rather than
     * restating it, for the same reason {@see self::apply()} shares a
     * definition with the count: a bucket whose dot said one thing and whose
     * rows all wore a chip saying another would be two answers to "what kind
     * of work is this", and the reader has no way to tell which is the real
     * one. Fourteen of the sixteen buckets cover a single status and simply
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
     * How many applications sit at each status in each lane, within one scope.
     *
     * Aggregated in the database, like {@see Review::tally}: the dashboard
     * needs a dozen numbers, and fetching the rows to count them would be a
     * firm's whole book loaded to answer them. Phase is in the GROUP BY so
     * both cards are answered from the same trip — Updates Required in
     * pre-approval is not the same work as Updates Required after a grant.
     *
     * @return array<string, array<string, int>>
     */
    private static function tallyByPhase(User $user, string $scope): array
    {
        $byPhase = [
            Phase::PRE_APPROVAL => [],
            Phase::POST_APPROVAL => [],
        ];

        $rows = self::scoped(ApplicationScope::query($user), $scope, $user)
            ->selectRaw('cip_applications.status as status, cip_applications.phase as phase, COUNT(*) as total')
            ->groupBy('cip_applications.status', 'cip_applications.phase')
            ->get();

        foreach ($rows as $row) {
            $phase = Phase::isValid((string) $row->phase) ? $row->phase : Phase::PRE_APPROVAL;
            $byPhase[$phase][$row->status] = (int) $row->total;
        }

        return $byPhase;
    }
}
