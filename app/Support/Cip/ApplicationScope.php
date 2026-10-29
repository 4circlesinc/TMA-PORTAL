<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyLocation;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * Which CIP applications an account may see, the row-level gate the module's
 * capability checks cannot provide.
 *
 * Administrators and officers see every application — the firm's book is
 * shared, assignment names who is working a file and fills their queue, it
 * does not hide the rest of the caseload. External accounts see exactly their
 * slice: a Service Provider contact (an active member of the firm a provider
 * is linked to) sees their firm's applications; a private client sees the
 * applications on their own client record. A contact who sits on a branch
 * sees only the applications assigned to that branch. The main office and a
 * service provider admin still see the firm's book. A parked Employee cannot
 * reach the portal and sees nothing here either.
 *
 * Use {@see self::query()} anywhere applications are listed, counted or
 * fetched; {@see self::findOrFail()} answers 404, never 403, so existence
 * never leaks (the ClientScope convention).
 */
class ApplicationScope
{
    /** @var array<int, list<int>> */
    private static array $visibleClientIds = [];

    /** @var array<int, list<int>> */
    private static array $providerIds = [];

    /**
     * Per company: whether this person reads the firm book, and which offices.
     *
     * @var array<int, array<int, array{firm: bool, mains: list<int>, branches: list<int>}>>
     */
    private static array $officeRules = [];

    /** An application query already narrowed to what this account may see. */
    public static function query(?User $user, ?Builder $base = null): Builder
    {
        $query = $base ?? CipApplication::query();

        // Module dark, or nobody signed in: no rows, not an error.
        if ($user === null || ! CipAccess::enabled()) {
            return $query->whereRaw('1 = 0');
        }

        /*
         * The people who work here. Administrators already held the book;
         * officers now read it too, assigned or not. Section 10 still has the
         * administrator hand a file to an officer to start the review, and
         * the dashboard queues still count only what that officer holds.
         * Seeing the rest of the firm is a separate question, and the firm
         * asked to share it.
         */
        if (Role::isAdmin($user) || CipAccess::isOfficer($user)) {
            return $query;
        }

        if (Role::isStaff($user)) {
            return $query->whereRaw('1 = 0');
        }

        /*
         * External accounts: the provider-firm slice, plus their own record.
         *
         * Both columns are qualified. This scope is the base of every CIP
         * listing and a caller is free to join whatever it needs onto it —
         * client_assignments carries a client_id of its own, and an
         * unqualified one here made the whole query ambiguous the moment
         * somebody did.
         */
        return $query->where(function (Builder $q) use ($user) {
            $q->where(function (Builder $firm) use ($user) {
                self::limitProvidersAndOffices($firm, $user);
            });

            $q->orWhereIn(
                'cip_applications.client_id',
                Client::query()->select('id')->where('user_id', $user->id)
            );
        });
    }

    /**
     * The firm's providers, and for a branch contact only that branch.
     *
     * A service provider admin reads every application the firm can. A
     * contact on the main office reads the firm book: applications nobody
     * has sent to a branch, plus any that sit on the main office. A contact
     * on a branch reads only what was assigned to that branch. Their own
     * client record stays visible either way; that match is the caller's.
     */
    private static function limitProvidersAndOffices(Builder $query, User $user): void
    {
        $providerIds = self::providerIdsFor($user);

        if ($providerIds === []) {
            $query->whereRaw('1 = 0');

            return;
        }

        if (Role::isServiceProviderAdmin($user)) {
            $query->whereIn('cip_applications.provider_id', $providerIds);

            return;
        }

        $providers = CipProvider::withTrashed()
            ->whereIn('id', $providerIds)
            ->get(['id', 'company_id']);

        $rules = self::officeRules($user);
        $byCompany = [];
        foreach ($providers as $provider) {
            $byCompany[(int) ($provider->company_id ?? 0)][] = (int) $provider->id;
        }

        $query->where(function (Builder $outer) use ($byCompany, $rules) {
            $first = true;
            foreach ($byCompany as $companyId => $ids) {
                $rule = $companyId === 0
                    ? self::unlinkedOfficeRule($rules)
                    : ($rules[$companyId] ?? self::unlinkedOfficeRule($rules));
                $method = $first ? 'where' : 'orWhere';
                $first = false;
                $outer->{$method}(function (Builder $one) use ($ids, $rule) {
                    $one->whereIn('cip_applications.provider_id', $ids);
                    self::applyOfficeRule($one, $rule);
                });
            }

            if ($first) {
                $outer->whereRaw('1 = 0');
            }
        });
    }

    /**
     * @param  array{firm: bool, mains: list<int>, branches: list<int>}  $rule
     */
    private static function applyOfficeRule(Builder $query, array $rule): void
    {
        if ($rule['firm']) {
            $query->where(function (Builder $q) use ($rule) {
                $q->whereNull('cip_applications.location_id');
                $ids = array_values(array_unique(array_merge($rule['mains'], $rule['branches'])));
                if ($ids !== []) {
                    $q->orWhereIn('cip_applications.location_id', $ids);
                }
            });

            return;
        }

        $ids = array_values(array_unique($rule['branches']));
        if ($ids === []) {
            $query->whereRaw('1 = 0');

            return;
        }

        $query->whereIn('cip_applications.location_id', $ids);
    }

    /**
     * A provider that is not linked to this person's company still belongs
     * to the firm when the names match. It follows the same office rule as
     * the seats they actually hold.
     *
     * @param  array<int, array{firm: bool, mains: list<int>, branches: list<int>}>  $rules
     * @return array{firm: bool, mains: list<int>, branches: list<int>}
     */
    private static function unlinkedOfficeRule(array $rules): array
    {
        $firm = false;
        $mains = [];
        $branches = [];
        foreach ($rules as $rule) {
            $firm = $firm || $rule['firm'];
            $mains = array_merge($mains, $rule['mains']);
            $branches = array_merge($branches, $rule['branches']);
        }

        if ($rules === []) {
            $firm = true;
        }

        return [
            'firm' => $firm,
            'mains' => array_values(array_unique($mains)),
            'branches' => array_values(array_unique($branches)),
        ];
    }

    /**
     * @return array<int, array{firm: bool, mains: list<int>, branches: list<int>}>
     */
    private static function officeRules(User $user): array
    {
        $uid = (int) $user->id;
        if (array_key_exists($uid, self::$officeRules)) {
            return self::$officeRules[$uid];
        }

        $rules = [];
        $members = CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->with('location')
            ->get();

        foreach ($members as $member) {
            $companyId = (int) $member->company_id;
            $rules[$companyId] ??= ['firm' => false, 'mains' => [], 'branches' => []];
            $location = $member->location;

            if (! $location instanceof CompanyLocation || $location->isMain()) {
                $rules[$companyId]['firm'] = true;
                if ($location instanceof CompanyLocation && $location->isMain()) {
                    $rules[$companyId]['mains'][] = (int) $location->id;
                }

                continue;
            }

            if ($location->kind === CompanyLocation::KIND_BRANCH) {
                $rules[$companyId]['branches'][] = (int) $location->id;
            }
        }

        return self::$officeRules[$uid] = $rules;
    }

    /**
     * Provider rows whose applications this account's firm may see.
     *
     * The row linked to the membership is the usual one. It is not the only
     * one. A company that was given a CIP code keeps an empty provider, while
     * the files stay on the folder-born provider of the same name, which was
     * never linked. A second company row of the same name does the same: the
     * people sit on one, the applications on the other. Either way the firm
     * opens All Applications and is told it has none.
     *
     * A provider already linked to a differently named firm stays that firm's.
     * Private-client filings stay on PRI. Memoised: one listing asks this
     * from the table, the tab counts and the filter menu.
     *
     * @return list<int>
     */
    public static function providerIdsFor(?User $user): array
    {
        if ($user === null) {
            return [];
        }

        $uid = (int) $user->id;
        if (array_key_exists($uid, self::$providerIds)) {
            return self::$providerIds[$uid];
        }

        return self::$providerIds[$uid] = self::resolveProviderIds($user);
    }

    /**
     * @return list<int>
     */
    private static function resolveProviderIds(User $user): array
    {
        $companies = Company::query()
            ->whereIn(
                'id',
                CompanyMember::query()
                    ->select('company_id')
                    ->active()
                    ->where('user_id', $user->id)
            )
            ->get(['id', 'name']);

        if ($companies->isEmpty()) {
            return [];
        }

        $companyIds = $companies->map(fn (Company $company) => (int) $company->id)->all();
        $keys = $companies
            ->map(fn (Company $company) => ProviderMerge::key($company->name))
            ->filter()
            ->unique()
            ->values();

        $ids = [];

        $providers = CipProvider::withTrashed()
            ->leftJoin('companies', 'companies.id', '=', 'cip_providers.company_id')
            ->where('cip_providers.code', '!=', CipProvider::PRIVATE_CLIENT_CODE)
            ->get([
                'cip_providers.id',
                'cip_providers.name',
                'cip_providers.company_id',
                'companies.name as firm_name',
            ]);

        foreach ($providers as $provider) {
            $companyId = $provider->company_id !== null ? (int) $provider->company_id : null;

            if ($companyId !== null && in_array($companyId, $companyIds, true)) {
                $ids[] = (int) $provider->id;

                continue;
            }

            if ($companyId === null) {
                foreach ($companies as $company) {
                    if (ProviderMerge::matches($provider, $company->name)) {
                        $ids[] = (int) $provider->id;
                        break;
                    }
                }

                continue;
            }

            // The other company row may have been renamed, or the provider
            // may still carry the firm's name after it was linked elsewhere.
            // Either name is the firm. A different name stays where it is.
            $names = [
                ProviderMerge::key((string) $provider->firm_name),
                ProviderMerge::key((string) $provider->name),
            ];
            foreach ($names as $firm) {
                if ($firm !== '' && $keys->contains($firm)) {
                    $ids[] = (int) $provider->id;
                    break;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * Client ids sitting on applications this account may see.
     *
     * The citizenship file is the application, but opening it still loads the
     * hub record and the client's document folder. Those surfaces used to
     * ask ClientScope / assignment, which hid a colleague's filing the
     * officer could already see on the caseload. One query, memoised: folder
     * access asks this per folder, and four queries on every Documents tab
     * would be the same cost FolderAccess already refused.
     *
     * @return list<int>
     */
    public static function visibleClientIds(?User $user): array
    {
        if ($user === null) {
            return [];
        }

        $uid = (int) $user->id;
        if (array_key_exists($uid, self::$visibleClientIds)) {
            return self::$visibleClientIds[$uid];
        }

        return self::$visibleClientIds[$uid] = self::query($user)
            ->whereNotNull('cip_applications.client_id')
            ->pluck('cip_applications.client_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    public static function forget(): void
    {
        self::$visibleClientIds = [];
        self::$providerIds = [];
        self::$officeRules = [];
    }

    /** Resolve one application by uuid within the viewer's slice, or 404. */
    public static function findOrFail(?User $user, string $uuid): CipApplication
    {
        return self::query($user)->where('uuid', $uuid)->firstOrFail();
    }
}
