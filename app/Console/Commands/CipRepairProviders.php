<?php

namespace App\Console\Commands;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\Folder;
use App\Support\Cip\ProviderMerge;
use App\Support\Cip\Providers;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use App\Support\Realtime\Live;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Give every service-provider company a CIP code, then file Private drawers
 * under the firm that referred them.
 *
 * A company that already matches one unlinked provider — the same match the
 * register merge uses — takes that provider and its code. A company with no
 * match is registered, and the code is the one {@see Providers::suggestCode}
 * would mint. A code that already prefixes applications is never rewritten.
 *
 * A folder sitting under the reserved Private provider moves only when its
 * client was referred by a company that now has a provider folder. A drawer
 * with no referring firm stays in Private.
 *
 * Lists the plan and writes nothing unless `--apply` is given.
 */
class CipRepairProviders extends Command
{
    protected $signature = 'cip:repair-providers
        {--apply : Write the codes and move the folders. Without it, only list the plan}';

    protected $description = 'Give service providers their CIP codes and file referred Private folders under those firms';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $links = $this->linkPlan();

        foreach ($links as $row) {
            $this->line(sprintf(
                '%s  %s  ->  %s',
                $row['action'],
                $row['company'],
                $row['detail'],
            ));
        }

        if ($links->contains(fn (array $row) => $row['action'] === 'skip')) {
            $this->warn('A company matched more than one provider, so it was left alone.');
        }

        $moves = $this->movePlan();
        $movable = $moves->where('move', true);
        $held = $moves->where('move', false);

        $this->newLine();
        $this->info($movable->count().' Private folder(s) belong to a service provider.');
        foreach ($movable->groupBy('provider') as $provider => $group) {
            $this->line('  '.$group->count().'  ->  '.$provider);
        }
        $this->line($held->count().' Private folder(s) have no referring firm, so they stay.');

        if (! $apply) {
            $this->newLine();
            $this->line('Nothing written. Run with --apply to write.');

            return self::SUCCESS;
        }

        $linked = 0;
        $registered = 0;

        foreach ($links as $row) {
            if ($row['action'] === 'link') {
                /** @var CipProvider $provider */
                $provider = $row['provider'];
                $provider->forceFill(['company_id' => $row['companyModel']->id])->save();
                $linked++;
            }

            if ($row['action'] === 'register') {
                Providers::register($row['companyModel'], null);
                $registered++;
            }
        }

        // A linked firm can still be pointing at a folder that was removed.
        // The library rule adopts the live folder of the same name, or makes
        // one, and that is the drawer the referrals move into.
        Company::query()->whereHas('cipProvider')->orderBy('id')->each(function (Company $company) {
            $provider = $company->cipProvider;
            if ($provider && $provider->code !== CipProvider::PRIVATE_CLIENT_CODE) {
                Providers::ensureFolder($provider);
            }
        });

        $moved = 0;
        $failed = 0;

        foreach ($this->movePlan()->where('move', true) as $row) {
            if (! $row['destination']) {
                $failed++;
                $this->warn($row['folder']->name.': '.$row['provider'].' has no folder yet.');

                continue;
            }

            try {
                DB::transaction(function () use ($row) {
                    $this->place($row['folder'], $row['destination']);
                });
                $moved++;
            } catch (Throwable $e) {
                $failed++;
                $this->warn($row['folder']->name.': '.$e->getMessage());
            }
        }

        Cache::forget('companies.directory');
        Live::staff(Live::COMPANIES);
        Live::staff(Live::FILES);

        $this->info("Linked {$linked}, registered {$registered}, moved {$moved} folder(s).");

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    /**
     * @return Collection<int, array{action: string, company: string, detail: string, companyModel: Company, provider: ?CipProvider}>
     */
    private function linkPlan(): Collection
    {
        $companies = Company::query()
            ->whereDoesntHave('cipProvider')
            ->orderBy('id')
            ->get();

        $free = CipProvider::query()
            ->whereNull('company_id')
            ->where('code', '!=', CipProvider::PRIVATE_CLIENT_CODE)
            ->orderBy('id')
            ->get()
            ->keyBy('id');

        $reserved = [];
        $plan = collect();

        foreach ($companies as $company) {
            $exact = $free->filter(
                fn (CipProvider $provider) => ProviderMerge::key($provider->name) === ProviderMerge::key($company->name)
            );

            $matches = $exact->isNotEmpty()
                ? $exact
                : $free->filter(fn (CipProvider $provider) => ProviderMerge::matches($provider, $company->name));

            if ($matches->count() > 1) {
                $plan->push([
                    'action' => 'skip',
                    'company' => $company->name,
                    'detail' => 'matches '.$matches->pluck('code')->implode(', '),
                    'companyModel' => $company,
                    'provider' => null,
                ]);

                continue;
            }

            if ($matches->count() === 1) {
                /** @var CipProvider $provider */
                $provider = $matches->first();
                $free->forget($provider->id);
                $plan->push([
                    'action' => 'link',
                    'company' => $company->name,
                    'detail' => $provider->code.' ('.$provider->name.')',
                    'companyModel' => $company,
                    'provider' => $provider,
                ]);

                continue;
            }

            $code = Providers::suggestCode($company->name, $reserved);
            $reserved[] = $code;
            $plan->push([
                'action' => 'register',
                'company' => $company->name,
                'detail' => $code,
                'companyModel' => $company,
                'provider' => null,
            ]);
        }

        return $plan;
    }

    /**
     * @return Collection<int, array{move: bool, folder: Folder, destination: ?Folder, provider: string}>
     */
    private function movePlan(): Collection
    {
        $private = CipProvider::query()->where('code', CipProvider::PRIVATE_CLIENT_CODE)->first();

        if (! $private?->folder_id) {
            return collect();
        }

        $folders = Folder::query()
            ->where('parent_id', $private->folder_id)
            ->orderBy('id')
            ->get();

        if ($folders->isEmpty()) {
            return collect();
        }

        $clients = Client::query()
            ->where(function ($query) use ($folders) {
                $query->whereIn('folder_id', $folders->modelKeys())
                    ->orWhereIn('id', $folders->pluck('client_id')->filter()->all());
            })
            ->get();

        $byFolder = $clients->filter(fn (Client $client) => $client->folder_id)->keyBy('folder_id');
        $byId = $clients->keyBy('id');

        $providers = CipProvider::query()
            ->whereNotNull('company_id')
            ->where('code', '!=', CipProvider::PRIVATE_CLIENT_CODE)
            ->with('folder')
            ->get()
            ->keyBy('company_id');

        $pending = [];

        // A dry run has not written yet. A link keeps the provider's folder.
        // A new code has no folder until apply, but the referral still belongs
        // to that firm and is counted in the plan.
        foreach ($this->linkPlan() as $row) {
            if ($row['action'] === 'link') {
                $provider = $row['provider'];
                $provider->company_id = $row['companyModel']->id;
                $providers->put($provider->company_id, $provider);
            }

            if ($row['action'] === 'register') {
                $pending[$row['companyModel']->id] = $row['detail'].' '.$row['company'];
            }
        }

        return $folders->map(function (Folder $folder) use ($byFolder, $byId, $providers, $pending) {
            $client = $byFolder->get($folder->id) ?? ($folder->client_id ? $byId->get($folder->client_id) : null);
            $companyId = $client?->referred_by_company_id;
            $provider = $companyId ? $providers->get($companyId) : null;
            $destination = $provider?->folder;
            $waiting = $destination === null && $companyId && ($provider !== null || isset($pending[$companyId]));

            return [
                'move' => $waiting || ($destination !== null && (int) $destination->id !== (int) $folder->parent_id),
                'folder' => $folder,
                'destination' => $destination,
                'provider' => $provider ? $provider->code.' '.$provider->name : ($pending[$companyId] ?? ''),
            ];
        });
    }

    private function place(Folder $folder, Folder $destination): void
    {
        $folder->refresh();

        if ((int) $folder->parent_id === (int) $destination->id) {
            return;
        }

        $name = Naming::nextAvailable(
            Naming::clean($folder->name) ?: 'Client',
            fn (string $candidate) => Folder::query()
                ->where('parent_id', $destination->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                ->where('id', '!=', $folder->id)
                ->exists()
        );

        if ($name !== $folder->name) {
            $folder->forceFill(['name' => $name])->save();
        }

        FolderTree::move($folder, $destination);
    }
}
