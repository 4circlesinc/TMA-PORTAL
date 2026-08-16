<?php

namespace App\Support\Clients;

use App\Models\CipApplication;
use App\Models\Client;
use App\Models\User;
use App\Support\Access\ClientScope;
use Illuminate\Support\Facades\Cache;

/**
 * Lean directory payloads for the Client hub and its preview surfaces.
 *
 * The firm has enough clients that rebuilding the full list on every sidebar
 * paint, search index warm-up and hub mount was the portal's dominant wait.
 * This builds the same lean records {@see Client::toDirectoryRecord()} once
 * and keeps them warm briefly so concurrent consumers share the work.
 */
final class ClientDirectory
{
    /** How long a rebuilt directory stays warm. Short enough that live writes
     *  feel current; long enough to absorb the sidebar + hub + search burst. */
    public const TTL_SECONDS = 60;

    /**
     * Columns the directory listing selects. Note the absence of `data`.
     *
     * @var list<string>
     */
    public const COLUMNS = [
        'id', 'uid', 'user_id', 'folder_id', 'company_id', 'name', 'client_type',
        'company', 'referral_type', 'referred_by_company_id', 'email', 'phone',
        'initial', 'initial_color', 'photo_url', 'deleted_at',
    ];

    /**
     * The full directory the signed-in account may see, with custom-field
     * definitions riding along for the hub form.
     *
     * @return array{clients: list<array<string, mixed>>, customFields: list<array<string, mixed>>}
     */
    public static function for(User $user): array
    {
        $key = self::cacheKey($user);

        return Cache::remember($key, self::TTL_SECONDS, function () use ($user) {
            $clients = self::baseQuery($user)
                ->orderBy('name')
                ->get()
                ->map->toDirectoryRecord()
                ->values()
                ->all();

            return [
                'clients' => $clients,
                'customFields' => ClientCustomFields::all(),
            ];
        });
    }

    /**
     * A short named slice for surfaces that only show a handful of rows
     * (right sidebar). Never loads or caches the full directory.
     *
     * @return list<array<string, mixed>>
     */
    public static function preview(User $user, int $limit = 10): array
    {
        $limit = max(1, min(20, $limit));

        return self::baseQuery($user)
            ->orderBy('name')
            ->limit($limit)
            ->get()
            ->map->toDirectoryRecord()
            ->values()
            ->all();
    }

    /**
     * Directory rows matching a search term, capped for global search.
     *
     * @return list<array<string, mixed>>
     */
    public static function searchRecords(User $user, string $term, int $limit = 12): array
    {
        $limit = max(1, min(50, $limit));
        $like = '%'.addcslashes($term, '\\%_').'%';
        $op = self::likeOperator();

        return self::baseQuery($user)
            ->where(function ($q) use ($like, $op, $term) {
                $q->where('name', $op, $like)
                    ->orWhere('email', $op, $like)
                    ->orWhere('phone', $op, $like)
                    ->orWhere('company', $op, $like)
                    ->orWhereRaw(self::blobTextExpression().' '.$op.' ?', [$like]);

                self::matchApplicationNumber($q, $term);
            })
            ->orderBy('name')
            ->limit($limit)
            ->get()
            ->map->toDirectoryRecord()
            ->values()
            ->all();
    }

    /**
     * Widen a client search to the application numbers §7 promises.
     *
     * "Users may search using either: Internal Number, CIP Number, Applicant
     * Name" — and a number is not a property of the client row, so the name
     * search alone could never answer `GAL26-00001`. Both numbers are matched,
     * not just whichever one is on display: the internal number stays in use
     * for invoices and reviews for the life of the application, so somebody
     * holding an invoice must still be able to find the applicant with it long
     * after every screen has switched to the CIP number.
     *
     * Anchored at the start rather than contained. A number is typed to find
     * one record, and `%00001%` would return every application of every year
     * whose sequence happens to contain those digits.
     *
     * Deliberately not scoped by CIP reach: the surrounding query is already
     * the reader's own client scope, and this only decides which of the
     * clients they may see are a match. A number they cannot otherwise reach
     * matches nothing they could not already list by name.
     */
    public static function matchApplicationNumber($query, string $term): void
    {
        $term = trim($term);
        if ($term === '') {
            return;
        }

        $prefix = mb_strtolower(addcslashes($term, '\\%_')).'%';

        $query->orWhereIn('id', CipApplication::query()
            ->whereNotNull('client_id')
            ->where(function ($q) use ($prefix) {
                $q->whereRaw('LOWER(internal_number) LIKE ?', [$prefix])
                    ->orWhereRaw('LOWER(cip_number) LIKE ?', [$prefix]);
            })
            ->select('client_id'));
    }

    /** Drop every warm directory entry so the next read rebuilds. */
    public static function flush(): void
    {
        // Per-user keys are unknown here; a short TTL covers employees. The
        // shared admin entry is the expensive one and is always addressable.
        Cache::forget('clients.directory.all');
    }

    /** Drop the warm entry for one account (and the shared admin entry). */
    public static function flushFor(?User $user): void
    {
        self::flush();

        if ($user) {
            Cache::forget('clients.directory.user.'.$user->id);
        }
    }

    private static function cacheKey(User $user): string
    {
        return ClientScope::seesEveryClient($user)
            ? 'clients.directory.all'
            : 'clients.directory.user.'.$user->id;
    }

    /** @return \Illuminate\Database\Eloquent\Builder<\App\Models\Client> */
    private static function baseQuery(User $user)
    {
        return ClientScope::query($user)
            ->select(self::COLUMNS)
            ->with([
                'folder:id,uuid',
                'companyRecord:id,uid,name',
                'referredByCompany:id,uid,name',
            ]);
    }

    private static function likeOperator(): string
    {
        return Client::query()->getConnection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
    }

    private static function blobTextExpression(): string
    {
        return Client::query()->getConnection()->getDriverName() === 'pgsql'
            ? 'clients.data::text'
            : 'clients.data';
    }
}
