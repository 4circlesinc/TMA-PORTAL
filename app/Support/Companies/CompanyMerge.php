<?php

namespace App\Support\Companies;

use App\Models\ActivityLog;
use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\Conversation;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Invitation;
use App\Models\Share;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Clients\ClientDirectory;
use App\Support\Files\FileValidationException;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use App\Support\Realtime\Live;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fold one service provider into another.
 *
 * The firm that remains keeps its name and, when it already has one, its CIP
 * code. Contacts, portal access, staff assignments, applications, and the
 * library folder of the other firm move across. The other firm is then removed.
 */
class CompanyMerge
{
    public static function absorb(Company $keeper, Company $duplicate, User $by): Company
    {
        abort_if(
            (int) $keeper->id === (int) $duplicate->id,
            422,
            'Choose a different service provider to merge.',
        );
        abort_if($keeper->isArchived(), 422, 'That service provider is archived.');

        DB::transaction(function () use ($keeper, $duplicate, $by) {
            self::moveContacts($duplicate, $keeper);
            self::moveAccess($duplicate, $keeper, $by);
            self::moveStaff($duplicate, $keeper);
            self::moveProviders($duplicate, $keeper);
            self::fillBlanks($keeper, $duplicate);

            Conversation::query()->where('company_id', $duplicate->id)->update(['company_id' => $keeper->id]);
            Share::query()->where('target_company_id', $duplicate->id)->update(['target_company_id' => $keeper->id]);
            Invitation::query()->where('company_id', $duplicate->id)->update(['company_id' => $keeper->id]);

            $duplicate->delete();

            ActivityLogger::log([
                'actor' => $by,
                'type' => 'company.merged',
                'module' => 'clients',
                'description' => $by->name.' merged '.$duplicate->name.' into '.$keeper->name,
                'subject' => $keeper,
                'old' => ['companyUid' => $duplicate->uid, 'company' => $duplicate->name],
                'new' => ['companyUid' => $keeper->uid, 'company' => $keeper->name],
            ]);
        });

        Cache::forget('companies.directory');
        ClientDirectory::flush();
        Live::staff(Live::CLIENTS);
        Live::staff(Live::COMPANIES);

        return $keeper->fresh() ?? $keeper;
    }

    private static function moveContacts(Company $duplicate, Company $keeper): void
    {
        Client::query()
            ->where('company_id', $duplicate->id)
            ->orderBy('id')
            ->each(function (Client $client) use ($keeper) {
                $data = is_array($client->data) ? $client->data : [];
                $work = is_array($data['work'] ?? null) ? $data['work'] : [];
                $work['company'] = $keeper->name;
                $data['work'] = $work;

                $client->forceFill([
                    'company_id' => $keeper->id,
                    'company' => $keeper->name,
                    'data' => $data,
                ])->save();
            });

        Client::query()
            ->where('referred_by_company_id', $duplicate->id)
            ->update(['referred_by_company_id' => $keeper->id]);
    }

    private static function moveAccess(Company $duplicate, Company $keeper, User $by): void
    {
        $keeperHasPrimary = CompanyMember::query()
            ->current()
            ->where('company_id', $keeper->id)
            ->where('is_primary', true)
            ->exists();

        CompanyMember::query()
            ->current()
            ->where('company_id', $duplicate->id)
            ->orderBy('id')
            ->get()
            ->each(function (CompanyMember $member) use ($keeper, $duplicate, $by, &$keeperHasPrimary) {
                $email = $member->displayEmail() ?: $member->email;

                if (! $email && ! $member->user_id) {
                    if ($member->is_primary && $keeperHasPrimary) {
                        $member->is_primary = false;
                    }
                    $member->forceFill(['company_id' => $keeper->id])->save();

                    return;
                }

                $flags = [];
                foreach (CompanyRoles::ABILITIES as $ability) {
                    $flags[$ability] = (bool) $member->{$ability};
                }

                $moved = CompanyMembers::add($keeper, array_merge([
                    'email' => $email,
                    'name' => $member->name,
                    'job_title' => $member->job_title,
                    'role' => $member->role ?: CompanyRoles::MEMBER,
                    'client_id' => $member->client_id,
                    'is_primary' => $member->is_primary && ! $keeperHasPrimary,
                ], $flags), $by, notify: false);

                if ($moved->is_primary) {
                    $keeperHasPrimary = true;
                }

                self::retargetInvitations($duplicate, $keeper, $member, $moved);
                CompanyMembers::remove($duplicate, $member, $by, notify: false);
            });
    }

    private static function retargetInvitations(
        Company $duplicate,
        Company $keeper,
        CompanyMember $leaving,
        CompanyMember $moved,
    ): void {
        $emails = array_values(array_unique(array_filter([
            Str::lower(trim((string) $leaving->email)),
            Str::lower(trim((string) $leaving->displayEmail())),
        ])));

        Invitation::query()
            ->where('type', Invitation::TYPE_COMPANY_MEMBER)
            ->where('company_id', $duplicate->id)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->where(function ($q) use ($emails, $leaving) {
                $q->where('access->companyMemberUuid', $leaving->uuid);
                if ($leaving->client_id) {
                    $q->orWhere('client_id', $leaving->client_id);
                }
                foreach ($emails as $email) {
                    $q->orWhereRaw('LOWER(email) = ?', [$email]);
                }
            })
            ->get()
            ->each(function (Invitation $invitation) use ($keeper, $moved) {
                $access = $invitation->access ?? [];
                $access['companyMemberUuid'] = $moved->uuid;
                $invitation->forceFill([
                    'company_id' => $keeper->id,
                    'access' => $access,
                ])->save();
            });
    }

    private static function moveStaff(Company $duplicate, Company $keeper): void
    {
        CompanyStaffAssignment::query()
            ->where('company_id', $duplicate->id)
            ->orderBy('id')
            ->get()
            ->each(function (CompanyStaffAssignment $row) use ($keeper) {
                $already = $row->status === CompanyStaffAssignment::STATUS_ACTIVE
                    && CompanyStaffAssignment::query()
                        ->live()
                        ->where('company_id', $keeper->id)
                        ->where('user_id', $row->user_id)
                        ->exists();

                if ($already) {
                    $row->forceFill([
                        'status' => CompanyStaffAssignment::STATUS_ENDED,
                        'ended_at' => now(),
                    ])->save();

                    return;
                }

                $row->forceFill(['company_id' => $keeper->id])->save();
            });
    }

    private static function moveProviders(Company $duplicate, Company $keeper): void
    {
        $drops = self::providersFor($duplicate);
        $kept = self::providersFor($keeper);
        /*
         * The files settle on a LIVE row. The register clean-up of 2026-09-24
         * ({@see \App\Support\Cip\ProviderMerge}) binned duplicate rows with
         * their company link intact, so a firm can still "have" a row that
         * is in the bin. Taking that one moved every application onto it:
         * each file read as having no service provider, and the firm left
         * the provider list, while the live row the files had been on was
         * retired below.
         */
        $keep = $kept->first(fn (CipProvider $provider) => ! $provider->trashed());

        if (! $keep && $drops->every(fn (CipProvider $provider) => $provider->trashed())) {
            // Nothing live on either side: bring back the row the files are on.
            $keep = $kept->concat($drops)->first(
                fn (CipProvider $provider) => CipApplication::withTrashed()->where('provider_id', $provider->id)->exists(),
            );
            if ($keep) {
                $keep->restore();
                $keep->forceFill(['company_id' => $keeper->id, 'name' => $keeper->name])->save();
            }
        }

        foreach ($drops as $drop) {
            if (! $keep && ! $drop->trashed()) {
                $drop->forceFill([
                    'company_id' => $keeper->id,
                    'name' => $keeper->name,
                ])->save();
                $keep = $drop->fresh() ?? $drop;

                continue;
            }

            if (! $keep || (int) $keep->id === (int) $drop->id) {
                continue;
            }

            // A binned row's folder may be another live row's since the
            // clean-up; only a live row's library is this firm's to fold in.
            if (! $drop->trashed()) {
                self::uniteFolders($keep, $drop);
            }

            CipApplication::withTrashed()
                ->where('provider_id', $drop->id)
                ->update(['provider_id' => $keep->id]);

            self::moveCounters($drop, $keep);

            $drop->forceFill([
                'code' => self::retiredCode($drop),
                'company_id' => null,
                'folder_id' => null,
            ])->save();
            if (! $drop->trashed()) {
                $drop->delete();
            }
        }

        if ($keep) {
            self::settleBinnedRows($kept, $keep);
        }
    }

    /**
     * Put back files a merge left on a binned provider row.
     *
     * Both merges move every application off a row before binning it, so a
     * binned row that still holds files is what {@see moveProviders} did
     * when it took a binned row for the keeper's. Each goes to its firm's
     * live row; a firm with none gets the binned row back, since it is the
     * one its files and numbers are on. A company merged away since is
     * followed to the firm that remains. Nothing is renumbered.
     *
     * @return array{moved: int, restored: int, left: list<string>}
     */
    public static function repairStranded(): array
    {
        $result = ['moved' => 0, 'restored' => 0, 'left' => []];

        $rows = CipProvider::onlyTrashed()
            ->whereIn('id', CipApplication::withTrashed()->select('provider_id'))
            ->orderBy('id')
            ->get();

        foreach ($rows as $row) {
            DB::transaction(function () use ($row, &$result) {
                $company = self::liveCompanyFor($row->company_id);
                $live = $company
                    ? CipProvider::query()->where('company_id', $company->id)->orderBy('id')->first()
                    : null;

                if ($live) {
                    $result['moved'] += CipApplication::withTrashed()
                        ->where('provider_id', $row->id)
                        ->update(['provider_id' => $live->id]);
                    self::moveCounters($row, $live);
                    $row->forceFill(['company_id' => null])->save();

                    return;
                }

                if ($company) {
                    $row->restore();
                    $row->forceFill(['company_id' => $company->id, 'name' => $company->name])->save();
                    $result['restored']++;

                    return;
                }

                // No firm left to name. A person has to choose where these go.
                $result['left'][] = $row->name.' ('.$row->code.')';
            });
        }

        if ($result['moved'] > 0 || $result['restored'] > 0) {
            Cache::forget('companies.directory');
            ClientDirectory::flush();
        }

        return $result;
    }

    /**
     * The live company an id names, following merges to the firm that remains.
     */
    private static function liveCompanyFor(?int $companyId): ?Company
    {
        for ($hops = 0; $companyId && $hops < 10; $hops++) {
            $company = Company::withTrashed()->find($companyId);

            if (! $company) {
                return null;
            }

            if (! $company->trashed()) {
                return $company;
            }

            $companyId = ActivityLog::query()
                ->where('activity_type', 'company.merged')
                ->where('subject_type', $company->getMorphClass())
                ->where('old_values->companyUid', $company->uid)
                ->latest('id')
                ->value('subject_id');
        }

        return null;
    }

    /**
     * The keeper's binned rows stop naming it.
     *
     * Anything still filed on one goes to the live row, and the company link
     * is cleared so no later merge or lookup takes the binned row for the
     * firm's own. Its folder is left alone: the clean-up could leave a
     * binned row and another firm's live row on the same folder, and folding
     * that folder in here would empty the other firm's library.
     *
     * @param  \Illuminate\Support\Collection<int, CipProvider>  $rows
     */
    private static function settleBinnedRows($rows, CipProvider $keep): void
    {
        foreach ($rows as $row) {
            if (! $row->trashed() || (int) $row->id === (int) $keep->id) {
                continue;
            }

            CipApplication::withTrashed()
                ->where('provider_id', $row->id)
                ->update(['provider_id' => $keep->id]);
            self::moveCounters($row, $keep);
            $row->forceFill(['company_id' => null])->save();
        }
    }

    /**
     * @return \Illuminate\Support\Collection<int, CipProvider>
     */
    private static function providersFor(Company $company)
    {
        return CipProvider::withTrashed()
            ->where('company_id', $company->id)
            ->orderBy('id')
            ->get()
            ->sortBy(fn (CipProvider $provider) => $provider->trashed() ? 1 : 0)
            ->values();
    }

    private static function uniteFolders(CipProvider $keep, CipProvider $drop): void
    {
        $keepFolder = $keep->folder_id ? Folder::query()->find($keep->folder_id) : null;
        $dropFolder = $drop->folder_id ? Folder::query()->find($drop->folder_id) : null;

        if (! $dropFolder || ($keepFolder && (int) $keepFolder->id === (int) $dropFolder->id)) {
            return;
        }

        if (! $keepFolder) {
            $keep->forceFill(['folder_id' => $dropFolder->id])->save();

            return;
        }

        self::mergeFolderInto($dropFolder, $keepFolder);
        $drop->forceFill(['folder_id' => null])->save();
        $dropFolder->delete();
    }

    /**
     * Put the duplicate firm's library inside the one that remains.
     *
     * A child with the same name is combined rather than left as a twin.
     * Files that would collide are kept, with a number on the name.
     */
    private static function mergeFolderInto(Folder $from, Folder $into): void
    {
        if ((int) $from->id === (int) $into->id) {
            return;
        }

        foreach (Folder::query()->where('parent_id', $from->id)->orderBy('id')->get() as $child) {
            $twin = Folder::query()
                ->where('parent_id', $into->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($child->name)])
                ->first();

            if ($twin) {
                self::mergeFolderInto($child, $twin);
                $child->delete();

                continue;
            }

            try {
                FolderTree::move($child, $into);
            } catch (FileValidationException $e) {
                abort(422, $e->getMessage());
            }
        }

        foreach (FileItem::query()->where('folder_id', $from->id)->orderBy('id')->get() as $file) {
            $name = Naming::nextAvailable($file->name, function (string $candidate) use ($into, $file) {
                return FileItem::query()
                    ->where('folder_id', $into->id)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                    ->where('id', '!=', $file->id)
                    ->exists();
            });

            $file->forceFill([
                'folder_id' => $into->id,
                'name' => $name,
            ])->save();
        }
    }

    private static function moveCounters(CipProvider $from, CipProvider $to): void
    {
        $rows = DB::table('cip_counters')->where('provider_id', $from->id)->get();

        foreach ($rows as $row) {
            $kept = DB::table('cip_counters')
                ->where('provider_id', $to->id)
                ->where('year', $row->year)
                ->when(
                    $row->lane === null,
                    fn ($q) => $q->whereNull('lane'),
                    fn ($q) => $q->where('lane', $row->lane),
                )
                ->first();

            if ($kept) {
                DB::table('cip_counters')->where('id', $kept->id)->update([
                    'last_sequence' => max((int) $kept->last_sequence, (int) $row->last_sequence),
                    'updated_at' => now(),
                ]);
                DB::table('cip_counters')->where('id', $row->id)->delete();

                continue;
            }

            DB::table('cip_counters')->where('id', $row->id)->update([
                'provider_id' => $to->id,
                'updated_at' => now(),
            ]);
        }
    }

    private static function retiredCode(CipProvider $provider): string
    {
        $code = substr('OLD'.$provider->id, 0, 8);
        $n = 0;

        while (CipProvider::withTrashed()->where('code', $code)->whereKeyNot($provider->id)->exists()) {
            $n++;
            $code = substr('Z'.$n.$provider->id, 0, 8);
            if ($n > 30) {
                return substr(strtoupper(Str::random(8)), 0, 8);
            }
        }

        return $code;
    }

    private static function fillBlanks(Company $keeper, Company $duplicate): void
    {
        $patch = [];

        foreach (['email', 'phone', 'website', 'notes', 'logo_url', 'industry'] as $field) {
            if (blank($keeper->{$field}) && filled($duplicate->{$field})) {
                $patch[$field] = $duplicate->{$field};
            }
        }

        if (blank($keeper->address) && filled($duplicate->address)) {
            $patch['address'] = $duplicate->address;
        }

        if ($patch !== []) {
            $keeper->forceFill($patch)->save();
        }
    }
}
