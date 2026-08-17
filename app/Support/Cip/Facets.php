<?php

namespace App\Support\Cip;

use App\Models\CipApplicationAssignment;
use App\Models\CipProvider;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * The values §8's filter menu offers, and how many rows sit behind each one.
 *
 * Sibling to {@see Buckets}, and built on the same promise: the number beside
 * a value and the table that value opens are measured by one definition, so
 * they cannot disagree. A facet reading "Rita Officer 6" that opens onto nine
 * rows is worse than offering no count at all — it is the portal telling
 * somebody there is work they then cannot find, which is the failure the
 * bucket counts were designed around and this class inherits.
 *
 * That promise is why {@see self::applyAssignees()} and
 * {@see self::applyProviders()} live here beside the counts rather than in the
 * controller. Whoever changes what "unassigned" means has to change it in one
 * place, and both halves move together.
 *
 * COUNTED OVER THE WHOLE SLICE, NOT THE SCREEN
 *
 * Every count is measured over everything the reader may see — what
 * {@see ApplicationScope} allows and nothing narrower. Not the current page,
 * which would make the menu describe fifty rows out of eleven thousand; and
 * not the current search or the other filters, which would make the numbers
 * move under the reader's hand as they built up a filter. The buckets already
 * answer this way and the two menus sit in the same panel, so a facet that
 * counted differently would read as one of them being wrong.
 *
 * DRAFTS ARE COUNTED HERE, UNLIKE IN THE BUCKETS
 *
 * Deliberately, and the difference is real rather than an oversight. A bucket
 * is a question about work to pick up, and a half-written application is
 * nobody's work yet. A facet is a question about the table in front of you,
 * and the table lists drafts — so a provider filtered to their own firm must
 * see the same rows the facet promised, drafts among them. The rule that
 * matters is the one both classes keep: the count is measured through the same
 * query as the list.
 *
 * NOT CACHED, AND MUST NOT BE
 *
 * Same reason {@see Buckets} gives. An officer who takes a file and watches
 * their own count sit still concludes the portal is broken, and the whole set
 * costs two grouped counts.
 */
class Facets
{
    /** What the browser sends for "nobody has picked this up". */
    public const UNASSIGNED = 'none';

    /**
     * Who could be holding applications in this reader's slice, and how many
     * each actually is.
     *
     * EVERY OFFICER, NOT ONLY THE BUSY ONES
     *
     * A filter menu is a list of the questions that can be asked, so it names
     * every officer the firm has even when their count is zero — "who has
     * nothing on" is a real question, and an officer who drops off the menu
     * the moment their desk clears is a menu that changes shape under the
     * reader. Zero is shown for the same reason the status list shows a
     * bucket with none in it.
     *
     * The full staff list is for readers who can see the whole book. A
     * provider contact is shown only the officers actually working their
     * firm's files: the roster is not theirs, and a menu naming every officer
     * would tell them how the firm is staffed.
     *
     * WHO COUNTS AS HOLDING IT
     *
     * The same two sources §8's Assigned To column draws, in the same order:
     * the officers on the application, and — only where there are none — the
     * staff assigned to the client it belongs to. The column falls back that
     * way because a file nobody has been put on is still somebody's client,
     * and the count has to fall back with it. Counting only the CIP
     * assignments reported an application as unassigned while the row beside
     * the number plainly named somebody, which is the one thing a facet must
     * never do.
     *
     * The unassigned row leads, because "what has nobody picked up" is the
     * question an administrator opens this menu to ask, and it is the one
     * answer that is not a person.
     *
     * @return list<array{id:string, name:string, avatar:string|null, count:int}>
     */
    public static function assignees(User $reader): array
    {
        /*
         * One grouped count over the live assignments, not one per officer.
         *
         * A firm with thirty officers would otherwise put thirty queries
         * behind every load of a table that already has eleven thousand rows
         * in production — the shape this module was redesigned to avoid.
         */
        $held = self::liveAssignments(ApplicationScope::query($reader))
            ->selectRaw('cip_application_assignments.user_id, COUNT(DISTINCT cip_applications.id) as total')
            ->groupBy('cip_application_assignments.user_id')
            ->pluck('total', 'user_id');

        /*
         * And the client's staff, for the applications no officer is on.
         *
         * `whereDoesntHave` is the fallback written as a query: these are
         * exactly the rows whose Assigned To cell shows the client's people
         * because the application's own list was empty. Without it a client
         * manager would be missing from the menu while their name sat in the
         * column.
         */
        /*
         * Joined through the client rather than reading the scope twice.
         *
         * The scope for a provider contact already constrains client_id, so
         * every column below is qualified: an unqualified `client_id` is
         * ambiguous the moment `clients` is in the query, and SQLite says so
         * rather than guessing.
         */
        $viaClient = ApplicationScope::query($reader)
            ->whereDoesntHave('assignments', fn ($a) => $a->live())
            ->join('clients', 'clients.id', '=', 'cip_applications.client_id')
            ->join('client_assignments', function ($join) {
                $join->on('client_assignments.client_id', '=', 'clients.id')
                    ->where('client_assignments.status', ClientAssignment::STATUS_ACTIVE)
                    ->where(fn ($q) => $q->whereNull('client_assignments.starts_at')
                        ->orWhere('client_assignments.starts_at', '<=', now()))
                    ->where(fn ($q) => $q->whereNull('client_assignments.ends_at')
                        ->orWhere('client_assignments.ends_at', '>', now()));
            })
            ->selectRaw('client_assignments.user_id, COUNT(DISTINCT cip_applications.id) as total')
            ->groupBy('client_assignments.user_id')
            ->pluck('total', 'user_id');

        foreach ($viaClient as $userId => $total) {
            $held[$userId] = ($held[$userId] ?? 0) + $total;
        }

        /*
         * The names, in one more query rather than joined into the count and
         * grouped by three columns.
         *
         * For staff this is the officer roster, so somebody with nothing on
         * is still offered. For everybody else it is exactly the people who
         * appeared in the tally above — no roster, and trashed included,
         * because an account in the Recycle Bin still holds its files until
         * somebody ends the assignment and dropping the name would leave its
         * count in the menu with nothing to call it.
         */
        $people = Role::isStaff($reader)
            ? User::query()
                ->whereIn('account_type', Role::OFFICERS)
                ->where('status', 'approved')
                ->get(['id', 'name', 'email', 'avatar_url'])
                ->keyBy('id')
            : collect();

        $missing = $held->keys()->diff($people->keys());

        if ($missing->isNotEmpty()) {
            $people = $people->union(
                User::withTrashed()
                    ->whereIn('id', $missing)
                    ->get(['id', 'name', 'email', 'avatar_url'])
                    ->keyBy('id')
            );
        }

        $officers = [];

        foreach ($people as $userId => $person) {
            $total = (int) ($held[$userId] ?? 0);

            $officers[] = [
                // A string, like the unassigned sentinel beside it, so the
                // browser holds one kind of value and the two cannot be told
                // apart by type on the way to the query string.
                'id' => (string) $userId,
                'name' => $person->name,
                'avatar' => $person->photoUrl(),
                'count' => $total,
            ];
        }

        // Busiest first, then by name. Ordering by id would order by when each
        // officer's account was created, which tells the reader nothing.
        usort($officers, fn (array $a, array $b) => $b['count'] <=> $a['count'] ?: strcmp($a['name'], $b['name']));

        // Always offered, zero included: "nobody has picked anything up" is
        // as much an answer as a number, and a row that vanishes on the good
        // days is one the reader stops looking for on the bad ones.
        return array_merge([[
            'id' => self::UNASSIGNED,
            'name' => 'Unassigned',
            'avatar' => null,
            'count' => self::countUnassigned($reader),
        ]], $officers);
    }

    /**
     * The provider firms this reader can filter by.
     *
     * Every firm they may see, whether or not it has filed anything yet — a
     * firm with nothing on the table is the answer to "has Aurora sent us
     * anything", and a list that only names the busy ones cannot answer it.
     * A provider contact still sees one row, their own, because that is the
     * whole of what they may see.
     *
     * @return list<array{id:string, name:string, code:string|null, companyId:string|null, count:int}>
     */
    public static function providers(User $reader): array
    {
        // One grouped count of what has been filed, keyed by firm...
        $filed = ApplicationScope::query($reader)
            ->join('cip_providers', 'cip_providers.id', '=', 'cip_applications.provider_id')
            ->selectRaw('cip_providers.uuid, COUNT(*) as total')
            ->groupBy('cip_providers.uuid')
            ->pluck('total', 'uuid');

        /*
         * ...and the firms themselves, which is a different question.
         *
         * Staff filter across the register; anybody else can only ever be
         * asking about the firms already in their own slice, so the tally is
         * the whole list for them and no register is read.
         */
        $firms = Role::isStaff($reader)
            ? CipProvider::query()->orderBy('name')->get(['uuid', 'name', 'code', 'company_id'])
            : CipProvider::query()->whereIn('uuid', $filed->keys())->orderBy('name')->get(['uuid', 'name', 'code', 'company_id']);

        $rows = $firms->sortByDesc(fn ($firm) => (int) ($filed[$firm->uuid] ?? 0))->values();

        return $rows->map(fn ($row) => [
            'id' => (string) $row->uuid,
            'name' => (string) $row->name,
            'code' => $row->code,
            /*
             * The client hub's company behind this firm, where there is one.
             *
             * Carried so the company profile's "See all" can resolve itself to
             * a provider: that button knows a company id and this filter keys
             * on a provider, and without the pairing it could only guess. Null
             * for a provider registered with no company row, which is why the
             * button checks before it offers itself.
             */
            'companyId' => $row->company_id === null ? null : (string) $row->company_id,
            'count' => (int) ($filed[$row->uuid] ?? 0),
        ])->all();
    }

    /**
     * Narrow a listing to the chosen officers.
     *
     * Several at once is an OR, which is what a checkbox list means: a reader
     * ticking two officers is asking for either one's work, not for the files
     * they somehow both hold. Across fields it stays an AND — Rita's files
     * that are also Delayed — because that is what a second question added to
     * the first one means.
     *
     * The unassigned sentinel is not a user id and cannot be resolved to one,
     * so it is answered as its own clause and may be combined with names: "not
     * picked up, or picked up by Rita" is a real question when you are looking
     * for cover.
     *
     * @param  list<string>  $chosen  user ids, and/or {@see self::UNASSIGNED}
     */
    public static function applyAssignees(Builder $query, array $chosen): Builder
    {
        $wantsUnassigned = in_array(self::UNASSIGNED, $chosen, true);
        $ids = array_values(array_filter(array_map('intval', array_diff($chosen, [self::UNASSIGNED]))));

        if (! $wantsUnassigned && $ids === []) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($wantsUnassigned, $ids) {
            if ($ids !== []) {
                $q->orWhereHas('assignments', fn ($a) => $a->live()->whereIn('user_id', $ids));

                // And through the client, for the applications no officer is
                // on — the same fallback the count and the column make, or
                // ticking a name would open a shorter list than it promised.
                $q->orWhere(fn (Builder $viaClient) => $viaClient
                    ->whereDoesntHave('assignments', fn ($a) => $a->live())
                    ->whereHas('client.assignments', fn ($a) => $a->live()->whereIn('user_id', $ids)));
            }

            if ($wantsUnassigned) {
                /*
                 * Nobody holds it *now*, by either route. An assignment that
                 * has ended is not a lighter shade of assigned — the officer
                 * has stopped working on it — so a file whose only assignment
                 * ran out belongs in this answer, and the live() window is
                 * what puts it there.
                 */
                $q->orWhere(fn (Builder $nobody) => self::whereNobodyHolds($nobody));
            }
        });
    }

    /**
     * Narrow a listing to the chosen provider firms, by uuid.
     *
     * @param  list<string>  $chosen
     */
    public static function applyProviders(Builder $query, array $chosen): Builder
    {
        if ($chosen === []) {
            return $query;
        }

        return $query->whereHas('provider', fn ($p) => $p->whereIn('uuid', $chosen));
    }

    /* ── internals ─────────────────────────────────── */

    /**
     * The scoped listing joined to its live assignments.
     *
     * A join rather than whereHas because this counts rather than filters, and
     * the count is per officer: the grouped total needs a row per (application,
     * officer) pair to group by, which a subquery does not produce. DISTINCT on
     * the application id is what keeps a file held by two officers from
     * counting twice for either of them.
     */
    private static function liveAssignments(Builder $query): Builder
    {
        return $query->join('cip_application_assignments', function ($join) {
            $join->on('cip_application_assignments.application_id', '=', 'cip_applications.id')
                ->where('cip_application_assignments.status', CipApplicationAssignment::STATUS_ACTIVE)
                ->whereNull('cip_application_assignments.ended_at');
        });
    }

    /**
     * How many of this reader's applications nobody currently holds.
     *
     * Neither source: no officer on the application, and nobody on its client
     * either. The same two the column reads, so a row counted here is a row
     * whose Assigned To cell really does say "Unassigned".
     */
    private static function countUnassigned(User $reader): int
    {
        return self::whereNobodyHolds(ApplicationScope::query($reader))->count();
    }

    /** The applications with neither an officer nor a client manager on them. */
    private static function whereNobodyHolds(Builder $query): Builder
    {
        return $query
            ->whereDoesntHave('assignments', fn ($a) => $a->live())
            ->whereDoesntHave('client.assignments', fn ($a) => $a->live());
    }
}
