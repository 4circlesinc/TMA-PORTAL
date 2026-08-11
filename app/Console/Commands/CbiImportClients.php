<?php

namespace App\Console\Commands;

use App\Models\CbiApplication;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cbi\ClientHubImporter;
use Illuminate\Console\Command;

class CbiImportClients extends Command
{
    protected $signature = 'cbi:import-clients
                            {--dry-run : Report what would be created without writing anything}
                            {--companies-only : Register the referral sources and stop}
                            {--folders : Also give every imported client its File Library folder}
                            {--provision-folders : Only create missing folders for already-linked CBI clients}
                            {--actor= : Email of the staff member to record as the creator}';

    protected $description = 'Bring the CBI caseload into the Client hub: a company per referral source, a client per applicant, linked';

    public function handle(): int
    {
        $actor = $this->resolveActor();
        if ($actor === false) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $withFolders = (bool) $this->option('folders');

        if ($withFolders && ! $actor) {
            $this->error('--folders needs --actor: a folder has to be owned by somebody.');

            return self::FAILURE;
        }

        $importer = new ClientHubImporter($actor, $dryRun, $withFolders);

        if ($dryRun) {
            $this->warn('Dry run — nothing will be written.');
        }

        if ($this->option('provision-folders')) {
            if (! $actor) {
                $this->error('--provision-folders needs --actor: a folder has to be owned by somebody.');

                return self::FAILURE;
            }

            $pending = \App\Models\Client::query()
                ->whereNull('folder_id')
                ->whereIn('id', CbiApplication::query()->whereNotNull('client_id')->select('client_id'))
                ->count();

            $this->info(sprintf('Provisioning folders for %s linked client%s…', number_format($pending), $pending === 1 ? '' : 's'));
            $bar = $this->output->createProgressBar(max(1, $pending));
            $bar->start();
            $created = $importer->provisionMissingFolders(fn () => $bar->advance());
            $bar->finish();
            $this->newLine(2);
            $this->info($created.' folder(s) created.');

            return self::SUCCESS;
        }

        $this->info('Registering referral sources as companies…');
        $companies = $importer->registerCompanies();

        $created = array_filter($companies, fn ($c) => $c['created']);
        uasort($created, fn ($a, $b) => $b['applications'] <=> $a['applications']);

        if ($created !== []) {
            $this->table(
                ['Company', 'Applications'],
                array_map(fn ($c) => [$c['name'], number_format($c['applications'])], array_slice($created, 0, 20))
            );
            if (count($created) > 20) {
                $this->line('  … and '.(count($created) - 20).' more.');
            }
        }

        $this->line(sprintf(
            '  %d registered, %d already existed.',
            $importer->stats['companiesCreated'],
            $importer->stats['companiesMatched'],
        ));

        if ($this->option('companies-only')) {
            $this->newLine();
            $this->info('Companies only — stopping before the applicants.');

            return self::SUCCESS;
        }

        $pending = CbiApplication::whereNull('client_id')->count();
        if ($pending === 0) {
            $this->newLine();
            $this->info('Every application already points at a client. Nothing to import.');

            return self::SUCCESS;
        }

        $this->newLine();
        $this->info(sprintf('Importing %s applicant%s into the Client hub…', number_format($pending), $pending === 1 ? '' : 's'));

        $bar = $this->output->createProgressBar($pending);
        $bar->start();
        $importer->importClients(fn () => $bar->advance());
        $bar->finish();
        $this->newLine(2);

        $s = $importer->stats;
        $this->table(['', 'Count'], [
            ['Clients created', number_format($s['clientsCreated'])],
            ['Skipped (no applicant name)', number_format($s['unnamed'])],
            ['Referred by a company', number_format($s['clientsCreated'] - $s['private'] - $s['noReferral'])],
            ['Private', number_format($s['private'])],
            ['No referral recorded', number_format($s['noReferral'])],
            ['Folders provisioned', number_format($s['foldersCreated'])],
        ]);

        if ($dryRun) {
            $this->warn('Dry run — nothing was written.');
        } else {
            $this->info('Done. The hub lists them at /clients.');
        }

        return self::SUCCESS;
    }

    /** @return User|null|false false signals a bad --actor */
    private function resolveActor(): User|null|false
    {
        $email = $this->option('actor');
        if (! $email) {
            return null;
        }

        $user = User::where('email', str($email)->lower())->first();
        if (! $user) {
            $this->error('No user with that email.');

            return false;
        }

        if (! Role::can($user, 'clients.manage')) {
            $this->error($user->name.' cannot manage clients, so they cannot be the creator of these records.');

            return false;
        }

        return $user;
    }
}
