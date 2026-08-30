<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\ClientAssignment;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Assignments;
use App\Support\Cip\Buckets;
use App\Support\Cip\Attention;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Confirmation;
use App\Support\Cip\Countries;
use App\Support\Cip\Dependents;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Engine;
use App\Support\Cip\Facets;
use App\Support\Cip\Intake;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Milestones;
use App\Support\Cip\PassportPhoto;
use App\Support\Cip\Phase;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Requirements;
use App\Support\Cip\Status;
use App\Support\Cip\Submission;
use App\Support\Cip\Tree;
use App\Support\Files\CommentReads;
use App\Support\Files\FileType;
use App\Support\Files\Presenter;
use App\Support\Files\Thumbnail;
use App\Support\Realtime\Live;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * CIP applications: what the intake wizard needs, and filing one.
 *
 * The gate is CipAccess, not the capability matrix alone. Service Provider
 * contacts and Private Clients are promised application creation by §1 and
 * hold no matrix capability by design. 404 rather than 403 throughout, the
 * portal's convention for anything a reader may not see.
 */
class CipApplicationController extends Controller
{
    /*
     * How many applications one sync page carries.
     *
     * Each is a whole family with their checklists, so this is not a cheap
     * row, and a first sync of the firm's whole book is a lot of them. Small
     * enough that a page answers before a phone gives up on it, large enough
     * that catching up after a week is not two hundred round trips.
     */
    private const SYNC_PAGE = 50;

    /** Rows in one page of the main application table (§8). */
    private const LIST_PAGE = 50;

    /**
     * Column keys the table headers may ask to order by.
     *
     * Anything else is ignored rather than rejected: a typed URL with a typo
     * should still open the worklist, not a 422.
     */
    private const LIST_SORTS = [
        'number', 'applicant', 'provider', 'contact', 'email',
        'investment', 'family', 'status', 'assigned',
    ];

    /** Everything the wizard needs to draw itself, in one request. */
    public function form(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        $phase = Phase::PRE_APPROVAL;
        $requested = (string) $request->query('phase', '');
        if ($requested === Phase::POST_APPROVAL) {
            $phase = Phase::POST_APPROVAL;
        }

        $providers = Intake::providersFor($user)
            ->map(fn (CipProvider $p) => ['id' => $p->uuid, 'name' => $p->name, 'code' => $p->code])
            ->values();

        return response()->json([
            'providers' => $providers,
            // One provider and no choice to make: the wizard shows the name
            // rather than a select of one.
            'providerFixed' => $providers->count() === 1,
            'countries' => Countries::options(),
            'investmentTypes' => InvestmentType::options(),
            'genders' => ['Male', 'Female'],
            /*
             * The wizard's document sections, from the same templates the
             * admin screen edits, so a requirement added, reworded or
             * retired there changes what the form asks without a deploy.
             * Only the people the form collects: the applicant's list and
             * the sponsor's. The photo controls stay their own thing and
             * are gated by the passport_photo template's own flags.
             */
            'requirements' => [
                'principal' => Intake::documentFields(ApplicantType::PRINCIPAL_APPLICANT, $phase),
                'sponsor' => Intake::documentFields(ApplicantType::SPONSOR, $phase),
                'spouse' => Intake::documentFields(ApplicantType::SPOUSE, $phase),
                'dependent_under_16' => Intake::documentFields(ApplicantType::DEPENDENT_UNDER_16, $phase),
                'dependent_16_over' => Intake::documentFields(ApplicantType::DEPENDENT_16_OVER, $phase),
            ],
            'phase' => $phase,
            'photoRequired' => collect([
                'principal' => ApplicantType::PRINCIPAL_APPLICANT,
                'sponsor' => ApplicantType::SPONSOR,
                'spouse' => ApplicantType::SPOUSE,
                'dependent_under_16' => ApplicantType::DEPENDENT_UNDER_16,
                'dependent_16_over' => ApplicantType::DEPENDENT_16_OVER,
            ])->mapWithKeys(fn (string $type, string $key) => [
                $key => (bool) (Intake::photoRequirement($type, $phase)?->required ?? ($key === 'principal')),
            ])->all(),
            'dependentAgeCutoff' => ApplicantType::cutoff(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        // A requirement takes a list of files; one file on its own still counts
        // as a list of one.
        Intake::normaliseDocuments($request);

        $data = $request->validate(Intake::rules(), Intake::messages());

        // A provider this account may not file under is not offered and not
        // accepted, the same list the form was drawn from decides.
        $provider = Intake::providersFor($user)->firstWhere('uuid', $data['providerId']);
        abort_unless($provider, 422, 'Choose a service provider you can file under.');

        $application = Intake::create($provider, $user, $data);

        Live::staff(Live::CIP);

        return response()->json([
            'application' => $this->record($application, $user),
        ], 201);
    }

    /**
     * Everything that has changed since the caller last asked.
     *
     * The pull half of working offline (docs/offline-plan.md, phase 2). A
     * device that has been on a plane comes back, replays what it queued, and
     * then asks this for whatever moved while it was away, so the cached
     * copy on the desktop is brought up to date without re-downloading eleven
     * thousand records.
     *
     * THE CURSOR IS A PAIR, AND HAS TO BE
     *
     * `updated_at` alone cannot page: two applications saved in the same
     * second straddling a page boundary means either one is served twice or
     * one is never served at all, and the second is a record that stays
     * silently wrong on somebody's laptop. So the cursor is the timestamp AND
     * the id, and the next page is "later than that timestamp, or the same
     * timestamp with a higher id".
     *
     * NO CURSOR MEANS EVERYTHING
     *
     * A first run has nothing to catch up from, so it walks the whole set a
     * page at a time, the same loop, no separate download path to keep in
     * step with this one.
     */
    public function sync(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $since = $this->cursorTime($request->query('since'));
        $after = (int) $request->query('after', 0);

        /*
         * Everything {@see record()} reads, loaded once for the page.
         *
         * It builds every row of this answer, so a relation it has to fetch
         * for itself is not one query, it is fifty. The officer names both
         * photo columns because photoUrl() falls back from one to the other,
         * and a column that was never selected reads as no photo at all.
         */
        $query = ApplicationScope::query($user)
            ->with(array_merge([
                'provider',
                'client',
                'assignedOfficer:id,name,email,avatar_url,provider_avatar_url',
                'people.documents.file',
            ], self::assigneeRelations()));

        if ($since !== null) {
            /*
             * `>=` on the id tie-break: the row the cursor ended on comes
             * again while its timestamp equals the cursor's, because it can
             * change AGAIN inside that instant and strictly-greater would
             * skip the second change for ever. One re-delivered record per
             * walk, absorbed by the upsert, same rule as the files cursor.
             */
            $query->where(function (Builder $q) use ($since, $after) {
                $q->where('updated_at', '>', $since)
                    ->orWhere(fn (Builder $same) => $same
                        ->where('updated_at', '=', $since)
                        ->where('id', '>=', $after));
            });
        }

        $page = $query
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit(self::SYNC_PAGE)
            ->get();

        $last = $page->last();

        $presenter = self::presenterFor($user, $page);
        $attention = Attention::forClients($user, $page->pluck('client_id')->filter()->all());

        return response()->json([
            'applications' => $page->map(fn ($application) => $this->record($application, $user, $presenter, $attention))->all(),
            /*
             * Where to carry on from. The caller stores this and hands it back
             * next time; it is deliberately opaque prose-free data rather than
             * a page number, because a page number means something different
             * the moment a row is written.
             */
            'cursor' => [
                'since' => $last ? $last->updated_at?->toIso8601String() : $request->query('since'),
                'after' => $last ? $last->id : $after,
            ],
            // A full page probably is not the end of the set. Saying so is
            // cheaper than a count over a scoped query that may be large.
            'more' => $page->count() === self::SYNC_PAGE,
        ]);
    }

    /**
     * A cursor timestamp, or null.
     *
     * An unparseable `since` is treated as no cursor at all rather than as an
     * error: the worst case is one device re-reading a page it already has,
     * and the alternative is a client that can never recover from a corrupt
     * value it stored itself.
     */
    private function cursorTime(?string $value): ?CarbonImmutable
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        try {
            return CarbonImmutable::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The main application table (§8).
     *
     * Its own endpoint rather than a widening of the client directory, for two
     * reasons. The directory answers with every client the reader may see —
     * eleven thousand of them, and pages in the browser; hanging an
     * application, its provider, its officer and a head-count off each of
     * those rows is the shape that put the container out of memory once
     * already. And the table lists applications, not clients: a client with no
     * application does not belong in it, and a client with two would appear
     * once.
     *
     * Paged on the server, and every column is either a column of the row or
     * an eager-loaded relation, no per-row query. Family size in particular
     * is `withCount`, because §8 puts it on every line and `people()->count()`
     * would be one query per application to answer it.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', 'string', 'max:32'],
            /*
             * The three the filter menu offers, each a comma-separated list.
             *
             * Lists rather than single values because the menu is checkboxes:
             * ticking New and Delayed asks for either, and a parameter that
             * could only carry one would have made the second tick silently
             * replace the first. Comma-separated rather than repeated keys so
             * the whole filter still fits in a link somebody can paste.
             *
             * The lengths are bounded because these arrive in a URL: `max:400`
             * is comfortably more than every bucket, officer and provider a
             * reader could tick at once, and small enough that a hand-typed
             * address cannot turn into a thousand-term WHERE IN.
             */
            'bucket' => ['nullable', 'string', 'max:400'],
            'assignee' => ['nullable', 'string', 'max:400'],
            'provider' => ['nullable', 'string', 'max:400'],
            'page' => ['nullable', 'integer', 'min:1'],
            'perPage' => ['nullable', 'integer', 'min:1', 'max:200'],
            /*
             * Which column, and which way.
             *
             * Applied on the server so page two of a sorted table is the next
             * fifty of the same order, not a reorder of whichever fifty this
             * page happened to hold. Unknown values are dropped in
             * {@see applyListSort()} rather than validated out, so a bookmark
             * with a typo still opens the worklist.
             */
            'sort' => ['nullable', 'string', 'max:32'],
            'dir' => ['nullable', 'string', 'max:4'],
            'phase' => ['nullable', 'string', 'max:24'],
        ]);

        $perPage = (int) ($data['perPage'] ?? self::LIST_PAGE);
        $postApprovalList = ($data['phase'] ?? '') === Phase::POST_APPROVAL;

        $query = ApplicationScope::query($user)
            ->with([
                'provider:id,uuid,name,code',
                'client:id,uid,name,email,phone,photo_url,initial,initial_color,user_id',
                'client.user:id',
                'assignedOfficer:id,name,email,avatar_url',
                // Live only, with their people: the column names who holds the
                // file now, and an ended assignment is somebody who has
                // stopped. Eager, because this is fifty rows.
                'assignments' => fn ($q) => $q->live()->with('user:id,name,email,avatar_url,provider_avatar_url'),
                /*
                 * Who is on this applicant.
                 *
                 * The client's live assignments, with their people. Ended and
                 * not-yet-started ones are excluded here rather than filtered
                 * after: an assignment that has run out is not a lighter shade
                 * of assigned, it is somebody who has stopped working on this
                 * client, and §8's column asks who is.
                 */
                'client.assignments' => fn ($q) => $q->live()
                    ->with('user:id,name,email,avatar_url,provider_avatar_url')
                    ->orderByDesc('is_primary'),
                /*
                 * Pre-approval lists need only the main applicant's name.
                 * Post-approval lists need the whole family so each member can
                 * show their own document progress in an expandable row.
                 */
                'people' => $postApprovalList
                    ? fn ($q) => $q->with('documents')->orderBy('id')
                    : fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
            ])
            ->withCount('people');

        if (! empty($data['status']) && Status::isValid($data['status'])) {
            $query->where('status', $data['status']);
        }

        if (! empty($data['phase']) && Phase::isValid($data['phase'])) {
            $query->where('phase', $data['phase']);
        }

        /*
         * A chip opening the table it counted.
         *
         * Applied by the SAME definition that measured the count, so the
         * number on the chip and the rows behind it cannot disagree, which
         * they would the moment this re-expressed a bucket as a status filter,
         * because four of them are a person as well as a status.
         *
         * A bucket that is not on this reader's dashboard was never offered to
         * them, so it answers 404 rather than an empty table: an empty table
         * says "none of these", and the truth is "not yours to ask".
         */
        $buckets = self::list($data['bucket'] ?? null);

        if ($buckets !== []) {
            $chosen = [];

            foreach ($buckets as $key) {
                $bucket = Buckets::find($user, $key);
                abort_unless($bucket, 404);
                $chosen[] = $bucket;
            }

            /*
             * Several buckets are an OR, one bucket is what it always was.
             *
             * Kept as two paths rather than collapsed into one, because
             * Buckets::apply is the single definition each count was measured
             * through, including the officer queues, which are a person as
             * well as a status. Re-expressing a set of them as one status list
             * here would be a second definition, and the first time the two
             * drifted the menu would promise rows the table could not produce.
             */
            if (count($chosen) === 1) {
                Buckets::apply($query, $chosen[0], $user);
            } else {
                $query->where(function ($q) use ($chosen, $user) {
                    foreach ($chosen as $bucket) {
                        $q->orWhere(fn ($inner) => Buckets::apply($inner, $bucket, $user));
                    }
                });
            }
        }

        /*
         * The other two narrow within the scope, never around it.
         *
         * An officer or a provider this reader cannot see simply matches
         * nothing, which is the same answer they would get for one that does
         * not exist, the listing is already scoped, so an id from outside it
         * can no more be filtered *to* than it can be read. That is the
         * portal's convention working by construction rather than by a check.
         */
        Facets::applyAssignees($query, self::list($data['assignee'] ?? null));
        Facets::applyProviders($query, self::list($data['provider'] ?? null));

        $this->applyListSearch($query, trim($data['q'] ?? ''));
        $this->applyListSort($query, $data['sort'] ?? null, $data['dir'] ?? null);

        $page = $query->paginate($perPage, ['*'], 'page', $data['page'] ?? 1);

        // Measured for the whole page at once, then handed to each row: the
        // dot on an applicant's face costs one query per table draw, not one
        // per applicant.
        $attention = Attention::forClients(
            $user,
            collect($page->items())->map(fn ($a) => $a->client_id)->filter()->all()
        );

        return response()->json([
            'applications' => collect($page->items())->map(fn ($a) => $this->row($a, $user, $attention))->all(),
            'page' => $page->currentPage(),
            'lastPage' => $page->lastPage(),
            'perPage' => $page->perPage(),
            'total' => $page->total(),
            'statuses' => collect(Status::listed())->map(fn (string $s) => [
                'value' => $s,
                'label' => Status::label($s),
                'tone' => Status::tone($s),
            ])->all(),
            'personStatuses' => PersonStatus::listed(),
            /*
             * What the filter menu can offer, and how much sits behind each.
             *
             * Sent with the listing rather than fetched separately because the
             * menu is opened from this table and nowhere else, and a second
             * round trip would mean the reader could open it before it had
             * anything to show. Measured over the whole slice rather than this
             * page, see {@see Facets}.
             */
            'assignees' => Facets::assignees($user),
            'providers' => Facets::providers($user),
            'phaseCounts' => $this->phaseCounts($user),
        ]);
    }

    /**
     * How many applications sit in each workflow lane for this reader.
     *
     * Measured over the whole scoped set, not the current page or phase filter,
     * so tab badges stay honest while the table narrows.
     *
     * @return array{all: int, pre_approval: int, post_approval: int}
     */
    private function phaseCounts(User $user): array
    {
        $counts = ApplicationScope::query($user)
            ->selectRaw('phase, COUNT(*) as aggregate')
            ->groupBy('phase')
            ->pluck('aggregate', 'phase');

        $pre = (int) ($counts[Phase::PRE_APPROVAL] ?? 0);
        $post = (int) ($counts[Phase::POST_APPROVAL] ?? 0);

        return [
            'all' => $pre + $post,
            'pre_approval' => $pre,
            'post_approval' => $post,
        ];
    }

    /**
     * One comma-separated filter parameter as a list of values.
     *
     * Blanks are dropped rather than passed on: "a,,b" is what a browser sends
     * when the last tick is cleared without rebuilding the string, and an
     * empty term would otherwise become a filter matching nothing at all.
     *
     * @return list<string>
     */
    private static function list(?string $raw): array
    {
        if ($raw === null || trim($raw) === '') {
            return [];
        }

        return array_values(array_unique(array_filter(
            array_map('trim', explode(',', $raw)),
            fn (string $value) => $value !== '',
        )));
    }

    /**
     * §7's search, on the table it lists: either number, or the applicant.
     *
     * The numbers are matched from the start, a number is typed to find one
     * record, while a name is matched anywhere, because people search on a
     * surname as readily as a first name.
     */
    private function applyListSearch($query, string $term): void
    {
        if ($term === '') {
            return;
        }

        $prefix = mb_strtolower(addcslashes($term, '\\%_')).'%';
        $anywhere = '%'.mb_strtolower(addcslashes($term, '\\%_')).'%';

        $query->where(function (Builder $q) use ($prefix, $anywhere) {
            $q->whereRaw('LOWER(cip_applications.internal_number) LIKE ?', [$prefix])
                ->orWhereRaw('LOWER(cip_applications.cip_number) LIKE ?', [$prefix])
                ->orWhereHas('client', fn (Builder $c) => $c
                    ->whereRaw('LOWER(clients.name) LIKE ?', [$anywhere]))
                ->orWhereHas('people', fn (Builder $p) => $p
                    ->whereRaw("LOWER(first_name || ' ' || last_name) LIKE ?", [$anywhere]));
        });
    }

    /**
     * Order the listing the way a column header asked.
     *
     * Subqueries rather than joins: a person or assignment join would multiply
     * rows, and a page of fifty would silently skip applications. No sort
     * stays newest-first, the table is a worklist, and the application filed
     * this morning is the one somebody is looking for.
     */
    private function applyListSort(Builder $query, ?string $sort, ?string $dir): void
    {
        if ($sort === null || $sort === '' || ! in_array($sort, self::LIST_SORTS, true)) {
            $query->orderByDesc('cip_applications.id');

            return;
        }

        $dir = strtolower((string) $dir) === 'asc' ? 'asc' : 'desc';

        match ($sort) {
            'number' => $this->orderByNullable(
                $query,
                'LOWER(COALESCE(cip_applications.cip_number, cip_applications.internal_number))',
                $dir,
            ),
            'applicant' => $this->orderByNullable($query, $this->mainApplicantNameSql(), $dir),
            'provider' => $this->orderByNullable(
                $query,
                '(SELECT LOWER(name) FROM cip_providers WHERE cip_providers.id = cip_applications.provider_id AND cip_providers.deleted_at IS NULL LIMIT 1)',
                $dir,
            ),
            'contact' => $this->orderByNullable(
                $query,
                '(SELECT LOWER(name) FROM clients WHERE clients.id = cip_applications.client_id AND clients.deleted_at IS NULL LIMIT 1)',
                $dir,
            ),
            'email' => $this->orderByNullable(
                $query,
                '(SELECT LOWER(email) FROM clients WHERE clients.id = cip_applications.client_id AND clients.deleted_at IS NULL LIMIT 1)',
                $dir,
            ),
            'investment' => $query->orderByRaw($this->investmentOrderSql().' '.$dir),
            'family' => $query->orderByRaw('people_count '.$dir),
            'status' => $query->orderByRaw($this->statusOrderSql().' '.$dir),
            'assigned' => $this->orderByNullable($query, $this->assignedNameSql(), $dir, $this->assignedNameBindings()),
            default => $query->orderByDesc('cip_applications.id'),
        };

        // Equals keep newest-first so paging a column of identical names does
        // not reshuffle them between requests.
        $query->orderByDesc('cip_applications.id');
    }

    /** Empty cells trail the named ones, in either direction. */
    private function orderByNullable(Builder $query, string $sql, string $dir, array $bindings = []): void
    {
        $query->orderByRaw('('.$sql.') IS NULL', $bindings)
            ->orderByRaw($sql.' '.$dir, $bindings);
    }

    private function mainApplicantNameSql(): string
    {
        return "(SELECT LOWER(first_name || ' ' || last_name) FROM cip_people WHERE cip_people.application_id = cip_applications.id AND cip_people.role = ".self::sqlString(CipPerson::ROLE_MAIN_APPLICANT).' AND cip_people.deleted_at IS NULL LIMIT 1)';
    }

    /**
     * The first live assignee's name, the same person the column leads with.
     *
     * Live window copied from {@see ClientAssignment::scopeLive()} rather than
     * joined, so a client with two officers does not become two rows.
     */
    private function assignedNameSql(): string
    {
        return '(SELECT LOWER(users.name) FROM client_assignments INNER JOIN users ON users.id = client_assignments.user_id AND users.deleted_at IS NULL WHERE client_assignments.client_id = cip_applications.client_id AND client_assignments.status = ? AND (client_assignments.starts_at IS NULL OR client_assignments.starts_at <= ?) AND (client_assignments.ends_at IS NULL OR client_assignments.ends_at > ?) ORDER BY client_assignments.is_primary DESC, client_assignments.id ASC LIMIT 1)';
    }

    /** @return list<mixed> */
    private function assignedNameBindings(): array
    {
        $now = now();

        return [ClientAssignment::STATUS_ACTIVE, $now, $now];
    }

    /** Lifecycle order, so Status sorts as the chips read rather than A–Z. */
    private function statusOrderSql(): string
    {
        $whens = [];
        foreach (Status::listed() as $i => $status) {
            $whens[$status] = $i;
        }
        $whens[Status::DRAFT] = $whens[Status::NEW] ?? 0;

        return self::sqlCase('cip_applications.status', $whens);
    }

    /** The form's own option order, not the stored code alphabetically. */
    private function investmentOrderSql(): string
    {
        $whens = [];
        foreach (array_keys(InvestmentType::ALL) as $i => $value) {
            $whens[$value] = $i;
        }

        return self::sqlCase('cip_applications.investment_type', $whens);
    }

    /** @param  array<string, int>  $whens */
    private static function sqlCase(string $column, array $whens): string
    {
        $sql = 'CASE '.$column;
        foreach ($whens as $value => $index) {
            $sql .= ' WHEN '.self::sqlString((string) $value).' THEN '.(int) $index;
        }

        return $sql.' ELSE '.count($whens).' END';
    }

    private static function sqlString(string $value): string
    {
        return "'".str_replace("'", "''", $value)."'";
    }

    /**
     * One row of §8, and only what §8 asks for.
     *
     * Deliberately not {@see record()}: that is the whole application with
     * every person and their checklists, which is the right answer for a
     * profile and a hundred times too much for a table of fifty lines.
     */
    /**
     * @param  array<int, array{comments: int, mentionsMe: bool, messages: int}>  $attention
     */
    private function row($application, User $viewer, array $attention = []): array
    {
        $main = $application->people->first();
        $client = $application->client;
        $officer = $application->assignedOfficer;

        return [
            'id' => $application->uuid,
            'clientUid' => $client?->uid,
            // Null unless something on this client's file is waiting for this
            // reader — see Cip\Attention. Absent means "draw nothing".
            'attention' => $client ? ($attention[$client->id] ?? null) : null,
            // §7: the CIP number once it exists, the internal one until then.
            'number' => $application->displayNumber(),
            'internalNumber' => $application->internal_number,
            'cipNumber' => $application->cip_number,
            // Not a column §8 draws: it is how the status picker tells a first
            // submission from a file going back to the Unit with its query
            // answered, and asks for the CIP number and the day only for the
            // first. Read off the row, so it costs nothing.
            'submittedAt' => $application->submitted_at?->toDateString(),
            // Their passport photo, which intake files as the client's picture.
            'photo' => $client?->photo_url,
            'applicantName' => $main
                ? trim($main->first_name.' '.$main->last_name)
                : ($client?->name ?? '-'),
            'provider' => $application->provider?->name,
            /*
             * Who to contact about this application.
             *
             * The client record's own contact, which for a provider-referred
             * application is the person the firm deals with there and for a
             * private client is the applicant. Not `unit_contact`, that is
             * the government's officer, a different question that §8 does not
             * ask on this row.
             */
            'contactPerson' => $client?->name,
            'contactEmail' => $client?->contactEmail(),
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            // "1 Main Applicant + 1 Sponsor + 4 Dependents = F6" (§8).
            'familySize' => (int) $application->people_count,
            'familyLabel' => 'F'.max(1, (int) $application->people_count),
            'status' => $application->status,
            'statusLabel' => Status::label($application->status),
            'statusTone' => Status::tone($application->status),
            'locked' => $application->isLocked(),
            'phase' => $application->phase ?? Phase::PRE_APPROVAL,
            'phaseLabel' => Phase::label($application->phase ?? Phase::PRE_APPROVAL),
            'availableTransitions' => $this->transitions($application, $viewer),
            'availableOverrides' => $this->overrides($application, $viewer),
            'assignedTo' => $this->assignees($application),
            'familyMembers' => $this->familyMembersForRow($application, $viewer),
        ];
    }

    /**
     * Post-approval family members for an expandable table row.
     *
     * Each person carries their own checklist status (derived from document
     * slots until dedicated post-approval statuses are defined), plus photo
     * and document progress for the expandable row.
     *
     * @return list<array{id:string,role:string,label:string,name:string,profileTab:string,photo:?string,passportPhotoUrl:?string,status:string,statusLabel:string,statusTone:string,docFiled:int,docTotal:int,docPending:int}>
     */
    private function familyMembersForRow(CipApplication $application, User $viewer): array
    {
        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return [];
        }

        $phase = Phase::POST_APPROVAL;
        $roles = [
            CipPerson::ROLE_MAIN_APPLICANT => 0,
            CipPerson::ROLE_SPONSOR => 1,
            CipPerson::ROLE_DEPENDENT => 2,
        ];

        return $application->people
            ->sortBy(fn (CipPerson $person) => [
                $roles[$person->role] ?? 3,
                $person->dependent_ordinal ?? 0,
                $person->id,
            ])
            ->values()
            ->map(function (CipPerson $person) use ($phase, $viewer) {
                $progress = $this->documentProgress($person, $phase);
                $status = PersonStatus::forPerson($person);

                $photoFile = $person->documents
                    ->firstWhere('type', DocumentTypes::PASSPORT_PHOTO)?->file;

                return [
                    'id' => $person->uuid,
                    'role' => $person->role,
                    'label' => Dependents::label($person),
                    'name' => $person->fullName(),
                    'profileTab' => $this->profileTabForPerson($person),
                    ...$this->personPhotoUrls($person, $photoFile),
                    ...$status,
                    'availableStatuses' => PersonStatus::availableTransitions($person, $viewer),
                    'availableStatusOverrides' => PersonStatus::availableOverrides($person, $viewer),
                    ...$progress,
                ];
            })
            ->all();
    }

    /** @return \Illuminate\Support\Collection<int, \App\Models\CipDocument> */
    private function documentsForPhase(CipPerson $person, string $phase)
    {
        $allowed = Requirements::forPhase(ApplicantType::for($person), $phase)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $docs = $person->relationLoaded('documents')
            ? $person->documents
            : $person->documents()->get();

        return $docs->filter(function ($slot) use ($allowed) {
            if ($slot->requirement_id === null) {
                return true;
            }

            return in_array((int) $slot->requirement_id, $allowed, true);
        });
    }

    /** @return array{docFiled:int,docTotal:int,docPending:int} */
    private function documentProgress(CipPerson $person, string $phase): array
    {
        $docs = $this->documentsForPhase($person, $phase);
        $total = $docs->count();
        $filed = $docs->filter(fn ($slot) => $slot->file_id !== null)->count();

        return [
            'docFiled' => $filed,
            'docTotal' => $total,
            'docPending' => max(0, $total - $filed),
        ];
    }

    private function profileTabForPerson(CipPerson $person): string
    {
        return match ($person->role) {
            CipPerson::ROLE_MAIN_APPLICANT => 'applicant',
            CipPerson::ROLE_SPONSOR => 'sponsor',
            default => 'dependents',
        };
    }

    /**
     * The next moves this reader may drive, what a status chip offers.
     *
     * The engine's list, not a second reading of the map, so a choice the
     * chip draws is one the status endpoint would accept.
     *
     * @return list<array{value:string,label:string,tone:string}>
     */
    private function transitions($application, User $viewer): array
    {
        return collect(Engine::availableTransitions($application, $viewer))
            ->map(fn (string $status) => [
                'value' => $status,
                'label' => Status::label($status),
                'tone' => Status::tone($status),
            ])            ->values()->all();
    }

    /**
     * Administrator-only jumps off the lifecycle map.
     *
     * @return list<array{value:string,label:string,tone:string}>
     */
    private function overrides($application, User $viewer): array
    {
        return collect(Engine::availableOverrides($application, $viewer))
            ->map(fn (string $status) => [
                'value' => $status,
                'label' => Status::label($status),
                'tone' => Status::tone($status),
            ])->values()->all();
    }

    /**
     * Who §8's "Assigned To" column names.
     *
     * Two sources, and the order matters. An application will carry its own
     * officer once the review workflow assigns one (phase 6); until then the
     * honest answer is the staff assigned to the CLIENT, which the hub has
     * recorded all along and which is who actually picks up the phone about
     * this applicant today. Showing "Unassigned" over a client with three
     * named people on them would be the table calling the firm's own records
     * a blank.
     *
     * A list rather than a name: a client can have a case officer and a
     * reviewer, and picking one of them to display would be the column
     * quietly choosing whose work counts.
     *
     * @return list<array{name:string|null,email:string|null,avatar:string|null,role:string|null}>
     */
    private function assignees($application): array
    {
        /*
         * Who is on this client, which is the same list the profile's Assigned
         * tab shows and edits.
         *
         * One record, deliberately. The tab and this column used to read
         * different tables, so staff put on from one place were invisible in
         * the other, and assigning somebody the column already named (because
         * they were on the client) changed the database and nothing on screen.
         * They are now the same rows: assign in either place and both follow.
         *
         * Live only. An assignment that has ended is not a lighter shade of
         * assigned, that person has stopped working on this, and §8's column
         * asks who is.
         */
        $person = fn ($a, string $role) => [
            'name' => $a->user->name,
            'first' => Str::of($a->user->name)->trim()->explode(' ')->first(),
            'email' => $a->user->email,
            'avatar' => $a->user->photoUrl(),
            'userId' => $a->user_id,
            'roles' => [$role],
        ];

        if ($application->client !== null) {
            return collect($application->client->assignments)
                ->filter(fn ($a) => $a->user !== null)
                ->map(fn ($a) => $person($a, $a->roleLabel()))
                ->values()
                ->all();
        }

        /*
         * No client record at all, nothing to share a list with.
         *
         * The application's own assignments answer instead. This cannot bring
         * back the bug the merge fixed: that came from a client's staff
         * standing in for officers on the file, and here there is no client
         * for anybody to stand in from.
         */
        return $application->assignments
            ->filter(fn ($a) => $a->user !== null)
            ->map(fn ($a) => $person($a, Assignments::roleLabel($a->role)))
            ->values()
            ->all();
    }

    /** One application, if this reader may see it. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $application = ApplicationScope::findOrFail($request->user(), $uuid);

        if ($application->folder_id === null) {
            Tree::provision($application, $request->user());
            $application->refresh();
        }

        /*
         * The checklist is settled on the read that opens ONE file, so the
         * detail tabs always show the templates as they stand, however a
         * template arrived, a seeder and an import included. Materialise is
         * idempotent and writes nothing when nothing changed, so this read
         * stays a read on every open-and-look. Deliberately NOT done on
         * sync() or index(): those serve fifty applications a page, and when
         * the templates HAVE moved, a per-row write there would touch every
         * application on the page, and the sync cursor answers "which
         * applications moved since?" from exactly that timestamp.
         */
        Requirements::materialiseApplication($application);
        $application->unsetRelation('people');

        return response()->json([
            'application' => $this->record($application, $request->user()),
        ]);
    }

    /** The application record shape, for controllers that update and re-read. */
    public function showRecord(CipApplication $application, User $user): array
    {
        Requirements::materialiseApplication($application);
        $application->unsetRelation('people');

        return $this->record($application->fresh(), $user);
    }

    /**
     * The application a client's profile is showing.
     *
     * Answered as null rather than 404 when there is none: a client can exist
     * without one, imported, or created by hand, and the profile asking
     * "which application is this person's" deserves "none yet" rather than an
     * error it has to special-case.
     */
    public function forClient(Request $request, string $uid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        /*
         * Scoped on the application, not the client.
         *
         * ClientScope answers "may you see this client", which is about hub
         * assignments and would refuse an officer looking at an application
         * they are perfectly entitled to work on. What governs here is CIP
         * reach, and ApplicationScope is what holds it, an application this
         * reader may not see comes back as none, which is what they would be
         * told anyway.
         */
        /*
         * Resolved THROUGH the scope, not beside it.
         *
         * Looking the client up first and scoping only the application told a
         * reader two different things: a uid nobody holds answered 404, and a
         * uid held by somebody they may not see answered 200 with null. That
         * difference is enumerable, and client uids are name slugs, so any
         * account that passes canReach, a contact at a rival firm included,
         * could have walked a list of names and learned which of them are the
         * firm's clients.
         *
         * One query, one answer: no application in your slice for that uid
         * reads the same whether the person exists or not.
         */
        $application = ApplicationScope::query($user)
            ->whereHas('client', fn ($q) => $q->where('uid', $uid))
            ->latest('id')
            ->first();

        // The client profile is the other detail read, settled here for the
        // same reason show() settles it, and kept off the fifty-row pages for
        // the same reason too.
        if ($application) {
            if ($application->folder_id === null) {
                Tree::provision($application, $user);
                $application->refresh();
            }
            Requirements::materialiseApplication($application);
            $application->unsetRelation('people');
        }

        /*
         * The hub record rides with the application.
         *
         * Opening a row from CIP Applications still asks the profile endpoint
         * (`/portal/clients/{uid}`), which is staff-only, ClientScope, so a
         * provider contact who can already see the filing got "Couldn't load
         * this client" on every click. The application they may see is enough
         * to name the person, and this is the one read that already answers
         * that question for them.
         */
        $client = $application?->client;
        if ($client) {
            $client->loadMissing(['folder', 'companyRecord', 'referredByCompany']);
        }

        return response()->json([
            'application' => $application ? $this->record($application, $user) : null,
            'client' => $client?->toRecord(),
        ]);
    }

    /**
     * Change one.
     *
     * The same body the form posts to create, because it is the same form —
     * see Intake::update for what happens to the people already on it.
     */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);
        abort_unless(CipAccess::canCreate($user), 404);
        abort_if($application->isLocked(), 422, Confirmation::LOCKED_MESSAGE);

        Intake::normaliseDocuments($request);
        $data = $request->validate(Intake::rules(editing: true), Intake::messages());

        try {
            $application = Intake::update($application, $user, $data);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /**
     * Move a granted pre-approval application into the post-approval lane.
     *
     * Provisions the post-approval folder tree and materialises the post-approval
     * checklist without duplicating files that carry forward.
     */
    public function enterPostApproval(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);
        abort_unless(CipAccess::canChangeApplicationStatus($user), 403);

        $application = PostApproval::enter($application, $user);

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /**
     * The Unit has it: record the date and the CIP number (§16, §7).
     *
     * The number is the point. Every surface renders `displayNumber()`, so
     * writing it here is what flips dashboards, reports, status screens, email
     * subjects and search off the internal number in one move.
     *
     * The capability is not checked here on purpose. Submission is a status
     * change and {@see Engine} owns those, it refuses the edge from anywhere
     * but Ready to submit, and refuses the actor without `cip.compliance`.
     * A second check in the controller would be a second place to get it wrong.
     */
    public function submit(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'cipNumber' => ['required', 'string', 'max:'.Submission::MAX_LENGTH],
            // Recorded, not assumed: staff enter a submission after the fact
            // as often as on the day, and defaulting silently to today would
            // put the wrong date on an audit trail.
            'submittedAt' => ['required', 'date'],
        ], [
            'cipNumber.required' => 'Enter the CIP application number from the Unit.',
            'submittedAt.required' => 'Enter the submission date.',
        ]);

        try {
            $application = Submission::record(
                $application,
                $user,
                $data['cipNumber'],
                Carbon::parse($data['submittedAt']),
            );
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /** Fix a CIP number that was typed wrong. The status does not move. */
    public function correctNumber(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'cipNumber' => ['required', 'string', 'max:'.Submission::MAX_LENGTH],
        ]);

        $application = Submission::correct($application, $user, $data['cipNumber']);

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /**
     * Fix a milestone date recorded wrong. The status does not move.
     *
     * §4d's Timeline card is the only place these six days are all visible at
     * once, so it is the place a wrong one gets noticed — and, until this,
     * the place nothing could be done about it. The rules are
     * {@see Milestones::correct()}'s, including the one that matters most:
     * only a day already recorded can be corrected, so this cannot be used to
     * reach a step the lifecycle has not driven.
     *
     * The capability is not checked here: Milestones reads it off the same
     * table that names the column, so the verb that writes a date and the
     * correction that fixes it can never be open to different people.
     */
    public function correctMilestone(Request $request, string $uuid, string $key): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'date' => ['required', 'date'],
        ], [
            'date.required' => 'Enter the corrected date.',
        ]);

        try {
            $application = Milestones::correct($application, $user, $key, Carbon::parse($data['date']));
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /**
     * The filed passport photo at the resolution it was filed in.
     *
     * Scoped through the application, not the person: whoever may read the
     * application may see who it is for, and nobody else may, a uuid in the
     * URL is not an argument for showing someone's face.
     */
    public function passportPhoto(Request $request, string $uuid)
    {
        $person = CipPerson::query()->where('uuid', $uuid)->firstOrFail();
        ApplicationScope::findOrFail($request->user(), $person->application->uuid);

        $photo = PassportPhoto::read($person);
        abort_unless($photo, 404);

        return response($photo['body'], 200, [
            'Content-Type' => $photo['mime'],
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }

    /**
     * @return array{fileId:string,fileName:string}|null
     */
    private function decisionLetter(CipApplication $application): ?array
    {
        if ($application->decision_letter_file_id === null) {
            return null;
        }

        $file = $application->relationLoaded('decisionLetterFile')
            ? $application->decisionLetterFile
            : $application->decisionLetterFile()->first();

        return $file ? ['fileId' => $file->uuid, 'fileName' => $file->name] : null;
    }

    /**
     * @param  ?array<int, array{comments: int, mentionsMe: bool, messages: int}>  $attention
     *                                Primed by the caller when it is drawing more than one
     *                                application; measured here for a single record.
     */
    private function record($application, User $viewer, ?Presenter $presenter = null, ?array $attention = null): array
    {
        // The slots' files as well as the slots: the checklist only needs to
        // know a slot is answered, but the passport photo is opened from here.
        $application->loadMissing(array_merge([
            'provider', 'client', 'assignedOfficer',
            'people.documents.file', 'people.documents.requirement',
        ], self::assigneeRelations()));

        /*
         * One presenter, primed once, for the family, or for the whole page.
         *
         * Presenter::file() rolls up shares, review status and favourites, and
         * unprimed it does that per file: six people would be six sets of the
         * same queries. Priming asks once.
         *
         * A caller reading MANY applications passes its own, primed across all
         * of them. Without that the priming was per application and the sync
         * page cost four queries a row on top of everything else, invisible
         * on a family of six and three hundred queries on a page of fifty.
         */
        $presenter ??= self::presenterFor($viewer, [$application]);

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $sponsor = $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR);
        // Numbered first and in their number, then the unnumbered, a spouse
        // carries no ordinal, and sorting on the column alone put null first,
        // so the family read Spouse, QD1, QD2 instead of the other way round.
        $dependents = $application->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->sortBy(fn (CipPerson $p) => ($p->dependent_ordinal ?? 9999) * 1000000 + $p->id)
            ->values();

        $phase = $application->phase ?? Phase::PRE_APPROVAL;

        return [
            'id' => $application->uuid,
            // §7: the internal number until the CIP number takes over.
            'number' => $application->displayNumber(),
            'internalNumber' => $application->internal_number,
            'cipNumber' => $application->cip_number,
            'submittedAt' => $application->submitted_at?->toDateString(),
            'queryReceivedAt' => $application->query_received_at?->toDateString(),
            'acceptedAt' => $application->accepted_at?->toDateString(),
            'decision' => $application->decision,
            'decidedAt' => $application->decided_at?->toDateString(),
            'decisionLetter' => $this->decisionLetter($application),
            'status' => $application->status,
            'statusLabel' => Status::label($application->status),
            'statusTone' => Status::tone($application->status),
            'phase' => $application->phase ?? Phase::PRE_APPROVAL,
            'phaseLabel' => Phase::label($application->phase ?? Phase::PRE_APPROVAL),
            'postApprovalAt' => $application->post_approval_at?->toIso8601String(),
            'personStatuses' => ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
                ? PersonStatus::listed()
                : [],
            ...Confirmation::payload($application, $viewer),
            'availableTransitions' => $this->transitions($application, $viewer),
            'availableOverrides' => $this->overrides($application, $viewer),
            'provider' => $application->provider?->name,
            'providerId' => $application->provider?->uuid,
            'providerCode' => $application->provider?->code,
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            // The stored values, for a form that has to put the record back
            // into its own controls. `investmentType` above is the display
            // string, which is the free text once somebody picked Other.
            'investmentTypeValue' => $application->investment_type,
            'investmentTypeOther' => $application->investment_type_other,
            'sponsored' => (bool) $application->sponsored,
            'familySize' => $application->familySize(),
            'familyLabel' => $application->familyLabel(),
            'applicant' => $main ? $this->person($main, $presenter, $phase) : null,
            'sponsor' => $sponsor ? $this->person($sponsor, $presenter, $phase) : null,
            'dependents' => $dependents->map(fn (CipPerson $p) => $this->person($p, $presenter, $phase))->all(),
            // §4d's Timeline card on Overview: how far the file has travelled,
            // and, because the steps it has not reached are answered too —
            // how far it has left to go.
            'milestones' => Milestones::for($application, $viewer),
            /*
             * Whether anything on this file is waiting for the reader — the
             * same block the applications table draws a dot from. On the
             * profile it is what puts a dot on the Documents tab, so the
             * conversation is findable before anybody opens the tab it is in.
             */
            /*
             * Primed by the caller where there is a page of these — measuring
             * it per record turned the sync listing into three queries per
             * application, which CipSyncScaleTest exists to catch.
             */
            'attention' => $application->client_id
                ? ($attention !== null
                    ? ($attention[$application->client_id] ?? null)
                    : (Attention::forClients($viewer, [$application->client_id])[$application->client_id] ?? null))
                : null,
            'assignedOfficer' => $this->officer($application),
            // The same people the table column and Assigned tab name, faces
            // on the facts strip under every tab, not a second list.
            'assignedTo' => $this->assignees($application),
            'createdAt' => $application->created_at?->toIso8601String(),
            // Which client's profile this belongs under, and when it last
            // moved. Both are for the offline cache: a record arriving from
            // the sync cursor has to be filed where the profile will look for
            // it, and a screen showing a copy has to be able to tell whether
            // what it holds is older than what just arrived.
            'clientUid' => $application->client?->uid,
            'updatedAt' => $application->updated_at?->toIso8601String(),
        ];
    }

    /**
     * Who {@see assignees()} names, loaded with the page rather than per row.
     *
     * The detail record carries the same list the table column draws, and a
     * relation it has to fetch for itself is not one query, it is fifty on a
     * sync page. Live only, both photo columns, because photoUrl() falls back
     * from one to the other and a column that was never selected reads empty.
     *
     * @return array<string, \Closure>
     */
    private static function assigneeRelations(): array
    {
        return [
            'assignments' => fn ($q) => $q->live()->with('user:id,name,email,avatar_url,provider_avatar_url'),
            'client.assignments' => fn ($q) => $q->live()
                ->with('user:id,name,email,avatar_url,provider_avatar_url')
                ->orderByDesc('is_primary'),
        ];
    }

    /**
     * The officer holding this application, or nobody.
     *
     * Read off the cache column rather than the assignments table, which is
     * what that column is for: {@see App\Support\Cip\Assignments} keeps it in
     * step with the live row, and asking the table here would be a query per
     * application on a sync page of fifty. One person rather than the list
     * {@see assignees()} builds, that column answers who is working this
     * client, where the record asks the narrower question of who the file was
     * actually handed to. A file nobody holds answers null rather than naming
     * the last officer who did.
     *
     * @return array{name:string|null,email:string|null,avatar:string|null}|null
     */
    private function officer($application): ?array
    {
        $officer = $application->assignedOfficer;

        if (! $officer) {
            return null;
        }

        return [
            'name' => $officer->name,
            'email' => $officer->email,
            'avatar' => $officer->photoUrl(),
        ];
    }

    /**
     * A presenter primed across every passport photo on these applications.
     *
     * @param  iterable<int, CipApplication>  $applications
     */
    private static function presenterFor(User $viewer, iterable $applications): Presenter
    {
        $photos = [];

        foreach ($applications as $application) {
            foreach ($application->people as $person) {
                $file = $person->documents
                    ->firstWhere('type', DocumentTypes::PASSPORT_PHOTO)?->file;

                if ($file) {
                    $photos[] = $file;
                }
            }
        }

        $presenter = new Presenter($viewer);
        $presenter->prime($photos, []);

        return $presenter;
    }

    /**
     * One individual, with their checklist.
     *
     * The same shape whoever it is, the caller already knows which role it
     * asked for, and a sponsor that described itself differently from an
     * applicant would mean two ways to read the same person.
     */
    private function person(CipPerson $person, Presenter $presenter, string $applicationPhase): array
    {
        $photoFile = $this->photoFileModel($person);
        $phase = $applicationPhase;
        $allowedRequirements = Requirements::forPhase(
            ApplicantType::for($person),
            $phase,
        )->pluck('id')->map(fn ($id) => (int) $id)->all();

        // One lookup for this person's whole checklist rather than one per
        // line: a main applicant owes a dozen documents.
        $slotComments = CommentReads::flagsForFiles(
            $presenter->viewer(),
            $person->documents->map(fn ($slot) => $slot->file?->id)->filter()->all()
        );
        $updateReasons = DocumentComments::latestOpenBodies(
            $person->documents->pluck('id')->all()
        );

        return [
            'id' => $person->uuid,
            'role' => $person->role,
            'label' => Dependents::label($person),
            'relationship' => $person->relationship,
            'dependentOrdinal' => $person->dependent_ordinal,
            'name' => $person->fullName(),
            // Both halves as well as the whole: the form asks for them
            // separately, and splitting a full name back apart guesses wrong
            // on everyone whose surname is two words.
            'firstName' => $person->first_name,
            'lastName' => $person->last_name,
            'gender' => $person->gender,
            'dateOfBirth' => $person->date_of_birth?->toDateString(),
            'countryOfBirth' => $person->country_of_birth,
            'countryOfResidence' => $person->country_of_residence,
            'region' => $person->region,
            'occupation' => $person->occupation,
            'passportNumber' => $person->passport_number,
            // The passport photo, doubling as the avatar every list draws.
            ...$this->personPhotoUrls($person, $photoFile),
            /*
             * The photo as it was filed, in the File Library's own shape.
             *
             * It IS a library file. DocumentSlots puts it in the person's
             * folder through Vault like every other document, so opening it
             * opens the library's viewer, with the comments, versions, review
             * and sharing that come with it. That viewer reads a whole file
             * row, so this is the same row the library would have handed it,
             * built by the same presenter rather than a hand-rolled subset
             * that would quietly lose a button.
             */
            'photoFile' => $photoFile ? $presenter->file($photoFile) : null,
            // §11's applicant types decide which checklist this person owes.
            'applicantType' => ApplicantType::for($person),
            'applicantTypeLabel' => ApplicantType::label(ApplicantType::for($person)),
            'documents' => $person->documents
                ->filter(function ($slot) use ($allowedRequirements) {
                    if ($slot->requirement_id === null) {
                        return true;
                    }

                    return in_array((int) $slot->requirement_id, $allowedRequirements, true);
                })
                ->sortBy(fn ($slot) => [
                    $slot->requirement?->sort_order ?? 10000,
                    $slot->id,
                ])
                ->values()
                ->map(function ($slot) use ($slotComments, $phase, $presenter, $updateReasons) {
                    DocumentSlots::reconcile($slot, null, false);
                    $slot->refresh();
                    $slot->loadMissing('file');
                    $status = $slot->displayStatus();
                    $reason = $status === DocumentStatus::UPDATE_REQUIRED
                        ? ($updateReasons[$slot->id] ?? $slot->file?->review_note)
                        : null;

                    return [
                        'id' => $slot->uuid,
                        'type' => $slot->type,
                        'label' => $slot->label,
                        'required' => (bool) $slot->required,
                        'carriedForward' => $phase === Phase::POST_APPROVAL
                            && $slot->requirement
                            && $slot->requirement->at_pre_approval
                            && $slot->requirement->carry_forward,
                        'uploaded' => $slot->isFilled(),
                        /*
                     * §12's own status, not the file library's review_status.
                     * They are different vocabularies with different rules, a
                     * document waiting for a reviewer is not the same idea as a
                     * library file marked "pending review", and conflating them
                     * would let either one overwrite the other.
                     */
                        'status' => $status,
                        'statusLabel' => DocumentStatus::label($status),
                        'statusTone' => DocumentStatus::tone($status),
                        'updateReason' => $reason ? (string) $reason : null,
                        'canReview' => Role::isStaff($presenter->viewer()),
                        'fileId' => $slot->isFilled() ? $slot->file?->uuid : null,
                        // The same chip the File Library and the Documents tab
                        // draw, from the same source, so a checklist line and
                        // the file behind it can never disagree about whether
                        // there is a conversation waiting.
                        'comments' => $slot->file ? ($slotComments[$slot->file->id] ?? null) : null,
                        'fileName' => $slot->isFilled() ? $slot->file?->name : null,
                        'fileSize' => $slot->isFilled() ? $slot->file?->size : null,
                        'fileExt' => $slot->isFilled() && $slot->file
                            ? strtolower(pathinfo($slot->file->name, PATHINFO_EXTENSION))
                            : null,
                        /*
                         * What the checklist draws beside the line: the picture
                         * of the document, the same one every other list in the
                         * portal shows.
                         *
                         * Only what a thumbnail needs, not a whole presented
                         * file row — a main applicant owes a dozen of these and
                         * presenting each one would cost a permission walk per
                         * line for a 28px image. The routes behind both URLs
                         * enforce access themselves, and `previewUrl` is what
                         * TMAFileThumbs paints page one of a PDF from, this
                         * stack having nothing that can rasterise one
                         * server-side.
                         */
                        ...$this->slotThumb($slot->isFilled() ? $slot->file : null),
                    ];
                })->values()->all(),
            'outstanding' => DocumentSlots::outstanding($person),
            ...($applicationPhase === Phase::POST_APPROVAL
                ? PersonStatus::forPerson($person)
                : []),
            'availableStatuses' => $applicationPhase === Phase::POST_APPROVAL
                && CipAccess::canChangeApplicationStatus($presenter->viewer())
                ? PersonStatus::availableTransitions($person, $presenter->viewer())
                : [],
            'availableStatusOverrides' => $applicationPhase === Phase::POST_APPROVAL
                ? PersonStatus::availableOverrides($person, $presenter->viewer())
                : [],
        ];
    }

    /**
     * Thumbnail fields for a filled slot: the server's image thumbnail where
     * GD can make one, and the preview route otherwise so a PDF can have its
     * first page painted in the browser.
     *
     * @return array<string, string|null>
     */
    private function slotThumb(?FileItem $file): array
    {
        if (! $file) {
            return ['thumbUrl' => null, 'previewUrl' => null, 'fileMime' => null, 'fileCategory' => null];
        }

        $ext = (string) $file->extension;

        return [
            'thumbUrl' => Thumbnail::supportsExt($ext) ? route('files.thumb', $file->uuid) : null,
            'previewUrl' => FileType::isPreviewable($ext) ? route('files.preview', $file->uuid) : null,
            'fileMime' => $file->mime_type,
            'fileCategory' => FileType::category($ext),
        ];
    }

    /** The file filling this person's passport-photo slot, if it is filled. */
    private function photoFileModel(CipPerson $person): ?FileItem
    {
        return $person->documents
            ->firstWhere('type', DocumentTypes::PASSPORT_PHOTO)?->file;
    }

    /**
     * Portrait URLs for one person.
     *
     * The avatar column on {@see CipPerson} is filled at intake, but a
     * dependant's face can exist only in the passport-photo slot until
     * something backfills it — every tab should still draw the same 168px row
     * the main applicant gets.
     *
     * @return array{photo:?string,passportPhotoUrl:?string}
     */
    private function personPhotoUrls(CipPerson $person, ?FileItem $photoFile = null): array
    {
        $photoUrl = $person->photoUrl();
        $passportPhotoUrl = $person->photo_path
            ? '/portal/cip/people/'.$person->uuid.'/passport-photo'
            : null;

        if ($photoFile) {
            $thumb = $this->slotThumb($photoFile);
            if (! $photoUrl) {
                $photoUrl = $thumb['thumbUrl'] ?? $thumb['previewUrl'] ?? null;
            }
            if (! $passportPhotoUrl) {
                $passportPhotoUrl = $thumb['previewUrl'] ?? $thumb['thumbUrl'] ?? null;
            }
        }

        if (! $photoUrl && $person->role === CipPerson::ROLE_MAIN_APPLICANT) {
            $photoUrl = $person->application?->client?->photo_url;
        }

        return [
            'photo' => $photoUrl,
            'passportPhotoUrl' => $passportPhotoUrl,
        ];
    }
}
