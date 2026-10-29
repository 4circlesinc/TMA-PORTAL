<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CompanyMember;
use App\Models\User;

/**
 * Which office of the firm an application belongs to.
 *
 * Naming a contact on the file puts the application on that contact's
 * office. A branch office is the only one that branch can open. The main
 * office, and a file with no office yet, stay on the firm book.
 */
final class OfficeAssignment
{
    public static function place(CipApplication $application, User $contact): void
    {
        $application->loadMissing('provider');
        $companyId = $application->provider?->company_id;

        $locationId = null;
        if ($companyId !== null) {
            $member = CompanyMember::query()
                ->active()
                ->where('company_id', $companyId)
                ->where('user_id', $contact->id)
                ->first();
            $locationId = $member?->location_id;
        }

        $application->location_id = $locationId;
        $application->save();
        self::forget();
    }

    /**
     * The office follows whoever was named last. With no contact left on the
     * file, it returns to the firm book.
     */
    public static function followHolders(CipApplication $application): void
    {
        $application->loadMissing('client');
        $latest = $application->client?->assignments()->live()
            ->where('role', Assignments::SERVICE_PROVIDER_CONTACT)
            ->with('user')
            ->orderByDesc('id')
            ->first();

        if ($latest?->user) {
            self::place($application, $latest->user);

            return;
        }

        $application->location_id = null;
        $application->save();
        self::forget();
    }

    /**
     * Office of each user at this application's firm.
     *
     * @param  list<int>  $userIds
     * @return array<int, array{kind: ?string, name: ?string}>
     */
    public static function forUsers(?int $companyId, array $userIds): array
    {
        $userIds = array_values(array_filter(array_map('intval', $userIds)));
        if ($companyId === null || $userIds === []) {
            return [];
        }

        return CompanyMember::query()
            ->where('company_id', $companyId)
            ->whereIn('user_id', $userIds)
            ->with('location:id,name,kind')
            ->get()
            ->mapWithKeys(fn (CompanyMember $member) => [
                (int) $member->user_id => [
                    'kind' => $member->location?->kind,
                    'name' => $member->location?->name,
                ],
            ])
            ->all();
    }

    private static function forget(): void
    {
        ApplicationScope::forget();
        FolderAccess::forget();
    }
}
