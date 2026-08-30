<?php

namespace App\Support\Companies;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\Folder;
use App\Models\User;

/**
 * The persistent person behind a login, when there is one.
 *
 * A Service Provider contact is three rows: the firm ({@see CipProvider}),
 * the membership ({@see CompanyMember}), and whichever user account currently
 * signs in as them. Historical records that hang off the user id alone vanish
 * or go nameless when that account is deleted and later re-invited. Membership
 * is the row that survives that, so anything a contact writes or does is
 * stamped with it.
 */
final class ContactIdentity
{
    /**
     * Memberships this login currently occupies, the ids "mine" queries use
     * after a re-invite hands the same person a new user row.
     *
     * @return list<int>
     */
    public static function idsFor(User $user): array
    {
        return CompanyMember::query()
            ->where('user_id', $user->id)
            ->pluck('id')
            ->all();
    }

    public static function forUser(?User $user, ?int $companyId = null): ?CompanyMember
    {
        return $user ? self::forUserId($user->id, $companyId) : null;
    }

    public static function forUserId(?int $userId, ?int $companyId = null): ?CompanyMember
    {
        if (! $userId) {
            return null;
        }

        $query = CompanyMember::query()->where('user_id', $userId);

        if ($companyId) {
            return $query->where('company_id', $companyId)
                // A removed membership is still the same person; re-adding
                // them revives this row rather than minting a second one.
                ->orderByRaw('CASE WHEN status = ? THEN 1 ELSE 0 END', [CompanyMember::STATUS_REMOVED])
                ->orderByDesc('id')
                ->first();
        }

        // A person in two firms is not uniquely a contact of either;
        // stamping the wrong membership would attach Galaxy's history to
        // a different company. Only bind when the company is known, or
        // they belong to exactly one.
        $matches = $query->orderByDesc('id')->limit(2)->get();

        return $matches->count() === 1 ? $matches->first() : null;
    }

    public static function companyIdForApplication(?CipApplication $application): ?int
    {
        if ($application === null) {
            return null;
        }

        $application->loadMissing('provider');

        return $application->provider?->company_id;
    }

    public static function companyIdForFile(?FileItem $file): ?int
    {
        if ($file === null) {
            return null;
        }

        $file->loadMissing('cipDocument.application.provider');

        if ($file->cipDocument?->application) {
            return self::companyIdForApplication($file->cipDocument->application);
        }

        return self::companyIdForFolder($file->folder_id);
    }

    public static function companyIdForFolder(?int $folderId): ?int
    {
        if ($folderId === null) {
            return null;
        }

        $folder = Folder::find($folderId);

        while ($folder !== null) {
            $person = CipPerson::query()->where('folder_id', $folder->id)->first();
            if ($person !== null) {
                $person->loadMissing('application.provider');

                return self::companyIdForApplication($person->application);
            }
            $folder = $folder->parent_id ? Folder::find($folder->parent_id) : null;
        }

        return null;
    }

    /**
     * What a historical row stores for this actor: the membership that
     * outlives the login, and a name that still reads after both are gone.
     *
     * @return array{company_member_id: int|null, actor_name: string|null}
     */
    public static function stamp(?User $actor, ?int $companyId = null): array
    {
        $member = self::forUser($actor, $companyId);

        return [
            'company_member_id' => $member?->id,
            'actor_name' => $actor?->name ?: $member?->displayName(),
        ];
    }

    public static function isSelf(User $viewer, ?int $userId, ?int $memberId, ?array $viewerMemberIds = null): bool
    {
        if ($userId && $userId === $viewer->id) {
            return true;
        }

        if ($memberId === null) {
            return false;
        }

        $ids = $viewerMemberIds ?? self::idsFor($viewer);

        return in_array($memberId, $ids, true);
    }

    /**
     * A login coming back onto a membership — the same person, a new user id.
     *
     * Workflow steps still have to reach them, and those rows were written
     * against the previous account. Comments stay keyed on the membership
     * and do not need this; they resolve "mine" through company_member_id.
     */
    public static function relink(CompanyMember $member, User $user): void
    {
        FileWorkflowStep::query()
            ->where('company_member_id', $member->id)
            ->where(function ($q) use ($user) {
                $q->whereNull('user_id')->orWhere('user_id', '!=', $user->id);
            })
            ->update(['user_id' => $user->id]);

        FileWorkflow::query()
            ->where('created_by_member_id', $member->id)
            ->whereNull('created_by')
            ->update(['created_by' => $user->id]);
    }

    /**
     * How history draws this actor: the live account, then the membership,
     * then the name written on the row when it happened.
     *
     * @return array{name: string, email: string|null, avatar: string|null, userId: int|null}
     */
    public static function present(?User $user, ?CompanyMember $member, ?string $snapshot = null): array
    {
        $name = $user?->name
            ?: ($member?->name ?: null)
            ?: $snapshot
            ?: $member?->displayEmail();

        if ($name === null || $name === '') {
            $name = 'a deleted account';
        }

        return [
            'name' => $name,
            'email' => $user?->email ?: $member?->email,
            'avatar' => $user?->photoUrl(),
            'userId' => $user?->id,
        ];
    }
}
