<?php

namespace App\Support\Companies;

use App\Models\Company;
use App\Models\CompanyLocation;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use Illuminate\Support\Str;

/**
 * The main office and branches under a service provider, and which of them
 * a portal user sits on.
 */
final class CompanyLocations
{
    public static function ensureMain(Company $company): CompanyLocation
    {
        $existing = CompanyLocation::query()
            ->where('company_id', $company->id)
            ->where('kind', CompanyLocation::KIND_MAIN)
            ->first();

        if ($existing) {
            return $existing;
        }

        return CompanyLocation::create([
            'uid' => self::uid($company->uid.'-main-office'),
            'company_id' => $company->id,
            'name' => self::mainName($company->name),
            'kind' => CompanyLocation::KIND_MAIN,
        ]);
    }

    /**
     * The main office keeps the firm's name while it is still the default
     * label. A name somebody typed by hand is left alone.
     */
    public static function followCompanyName(Company $company, string $previousName): void
    {
        $main = self::ensureMain($company);
        if ($main->name !== self::mainName($previousName)) {
            return;
        }

        $main->name = self::mainName($company->name);
        $main->save();
    }

    public static function addBranch(Company $company, string $name, User $by): CompanyLocation
    {
        self::ensureMain($company);
        $name = self::branchName($name);

        abort_if($name === '', 422, 'Name the branch.');
        abort_if(self::nameTaken($company, $name), 422, 'This service provider already has a location with that name.');

        $location = CompanyLocation::create([
            'uid' => self::uid($company->uid.'-'.$name),
            'company_id' => $company->id,
            'name' => $name,
            'kind' => CompanyLocation::KIND_BRANCH,
        ]);

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.branch_added',
            'module' => 'clients',
            'description' => $by->name.' added branch '.$location->name.' at '.$company->name,
            'subject' => $company,
            'metadata' => ['companyUid' => $company->uid, 'locationUid' => $location->uid],
        ]);

        return $location;
    }

    /**
     * A branch goes away. Its users move to the main office so they keep
     * their access at the firm.
     */
    public static function removeBranch(Company $company, CompanyLocation $location, User $by): void
    {
        abort_unless((int) $location->company_id === (int) $company->id, 404);
        abort_if($location->isMain(), 422, 'The main office stays with the service provider.');

        $main = self::ensureMain($company);

        CompanyMember::query()
            ->where('company_id', $company->id)
            ->where('location_id', $location->id)
            ->update(['location_id' => $main->id]);

        $name = $location->name;
        $uid = $location->uid;
        $location->delete();

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.branch_removed',
            'module' => 'clients',
            'description' => $by->name.' removed branch '.$name.' at '.$company->name,
            'subject' => $company,
            'metadata' => ['companyUid' => $company->uid, 'locationUid' => $uid],
        ]);
    }

    /**
     * Put this member on a location of this firm. No choice means the main office.
     */
    public static function idFor(Company $company, ?string $uid): int
    {
        if ($uid !== null && $uid !== '') {
            $id = CompanyLocation::query()
                ->where('company_id', $company->id)
                ->where('uid', $uid)
                ->value('id');

            abort_if($id === null, 422, 'Choose an office or branch at this service provider.');

            return (int) $id;
        }

        return (int) self::ensureMain($company)->id;
    }

    public static function place(Company $company, CompanyMember $member, ?string $uid): CompanyMember
    {
        $member->location_id = self::idFor($company, $uid);
        $member->save();

        return $member->fresh(['user', 'client', 'location']) ?? $member;
    }

    /** Anyone not yet on a location sits at the main office. */
    public static function placeUnassigned(Company $company): void
    {
        $main = self::ensureMain($company);

        CompanyMember::query()
            ->where('company_id', $company->id)
            ->whereNull('location_id')
            ->update(['location_id' => $main->id]);
    }

    /**
     * Main office first, then branches by name.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function records(Company $company): array
    {
        self::placeUnassigned($company);

        return CompanyLocation::query()
            ->where('company_id', $company->id)
            ->orderBy('name')
            ->orderBy('id')
            ->get()
            ->sortBy(fn (CompanyLocation $location) => ($location->isMain() ? '0' : '1').mb_strtolower($location->name))
            ->values()
            ->map(fn (CompanyLocation $location) => $location->toRecord())
            ->all();
    }

    public static function mainName(string $companyName): string
    {
        return trim($companyName).' Main Office';
    }

    private static function branchName(string $name): string
    {
        $name = trim($name);
        $name = preg_replace('/^branch\s*:\s*/i', '', $name) ?? $name;

        return trim($name);
    }

    private static function nameTaken(Company $company, string $name): bool
    {
        return CompanyLocation::query()
            ->where('company_id', $company->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists();
    }

    private static function uid(string $base): string
    {
        $base = Str::slug($base) ?: 'location';
        $base = Str::limit($base, 80, '');
        $uid = $base;
        $i = 2;

        while (CompanyLocation::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$i;
            $i++;
        }

        return $uid;
    }
}
