<?php

namespace App\Support\Cip;

use App\Models\CipApplicationAssignment;
use App\Models\User;
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
     * Who holds applications in this reader's slice, and how many each.
     *
     * The unassigned count leads, because "what has nobody picked up" is the
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

        if ($held->isEmpty()) {
            $people = collect();
        } else {
            // One more query for the names, rather than joining users into the
            // count and grouping by three columns. Trashed included: an
            // account in the Recycle Bin still holds its files until somebody
            // ends the assignment, and dropping the name here would leave its
            // count in the menu with nothing to call it.
            $people = User::withTrashed()
                ->whereIn('id', $held->keys())
                ->get(['id', 'name', 'email', 'avatar_url'])
                ->keyBy('id');
        }

        $officers = [];

        foreach ($held as $userId => $total) {
            $person = $people->get($userId);

            if ($person === null) {
                continue;
            }

            $officers[] = [
                // A string, like the unassigned sentinel beside it, so the
                // browser holds one kind of value and the two cannot be told
                // apart by type on the way to the query string.
                'id' => (string) $userId,
                'name' => $person->name,
                'avatar' => $person->photoUrl(),
                'count' => (int) $total,
            ];
        }

        // Busiest first, then by name. Ordering by id would order by when each
        // officer's account was created, which tells the reader nothing.
        usort($officers, fn (array $a, array $b) => $b['count'] <=> $a['count'] ?: strcmp($a['name'], $b['name']));

        $unassigned = self::countUnassigned($reader);

        // Offered only when there is something behind it. A menu that always
        // carries "Unassigned 0" trains the reader to ignore the one row they
        // most need to notice on the day it is not zero.
        return $unassigned > 0
            ? array_merge([[
                'id' => self::UNASSIGNED,
                'name' => 'Unassigned',
                'avatar' => null,
                'count' => $unassigned,
            ]], $officers)
            : $officers;
    }

    /**
     * The provider firms with applications in this reader's slice.
     *
     * @return list<array{id:string, name:string, code:string|null, companyId:string|null, count:int}>
     */
    public static function providers(User $reader): array
    {
        $rows = ApplicationScope::query($reader)
            ->join('cip_providers', 'cip_providers.id', '=', 'cip_applications.provider_id')
            ->selectRaw('cip_providers.uuid, cip_providers.name, cip_providers.code, cip_providers.company_id, COUNT(*) as total')
            ->groupBy('cip_providers.uuid', 'cip_providers.name', 'cip_providers.code', 'cip_providers.company_id')
            ->orderByDesc('total')
            ->orderBy('cip_providers.name')
            ->get();

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
            'count' => (int) $row->total,
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
            }

            if ($wantsUnassigned) {
                // Nobody holds it *now*. An assignment that has ended is not a
                // lighter shade of assigned — the officer has stopped working
                // on it — so a file whose only assignment ran out belongs in
                // this answer, and whereDoesntHave over the live() window is
                // what puts it there.
                $q->orWhereDoesntHave('assignments', fn ($a) => $a->live());
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

    /** How many of this reader's applications nobody currently holds. */
    private static function countUnassigned(User $reader): int
    {
        return ApplicationScope::query($reader)
            ->whereDoesntHave('assignments', fn ($a) => $a->live())
            ->count();
    }
}
