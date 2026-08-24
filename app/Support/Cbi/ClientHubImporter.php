<?php

namespace App\Support\Cbi;

use App\Models\CbiApplication;
use App\Models\Client;
use App\Models\Company;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Naming;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Brings the CBI caseload into the Client hub.
 *
 * The applications arrive from Smartsheet, where "Referred By" is free text
 * typed by whoever opened the file. So the hub gets two things out of one
 * pass: a registered company for every distinct referral source, and a client
 * record for every applicant, linked to the company that sent them.
 *
 * Two properties matter more than speed. It is **idempotent**, an application
 * already pointing at a client is left alone, so it can run after every sync.
 * And it **never merges two referral sources it cannot prove are the same**:
 * only case and whitespace are normalised away. "Golden Visa Consultants" and
 * "GOLDEN VISA CONSULTANCY" stay separate, because deciding they are one firm
 * is the office's call, not a string comparison's.
 */
class ClientHubImporter
{
    /** Typed into Referred By to mean "no company sent them", not a firm. */
    private const PRIVATE_MARKERS = ['private', 'private client', 'direct', 'n/a', 'na', 'none'];

    /** @var array<string, Company> keyed by the normalised referral name */
    private array $companies = [];

    /** @var array<string, true> every client uid already spoken for */
    private array $takenUids = [];

    /** @var array<string, int> */
    public array $stats = [
        'companiesCreated' => 0,
        'companiesMatched' => 0,
        'clientsCreated' => 0,
        'clientsSkipped' => 0,
        'unnamed' => 0,
        'private' => 0,
        'noReferral' => 0,
        'foldersCreated' => 0,
    ];

    public function __construct(
        private ?User $actor = null,
        private bool $dryRun = false,
        private bool $withFolders = false,
    ) {}

    /**
     * Fold every distinct Referred By value into a Company.
     *
     * Runs first and on its own so the referral sources are registered before
     * a single client points at one, the order the office asked for, and the
     * only order in which a client can be linked as it is created.
     *
     * @return array<string, array{name: string, applications: int, created: bool}>
     */
    public function registerCompanies(): array
    {
        $rows = CbiApplication::query()
            ->selectRaw('referred_by, count(*) as n')
            ->whereNotNull('referred_by')
            ->where('referred_by', '!=', '')
            ->groupBy('referred_by')
            ->get();

        // Group the spellings, then let each group pick its own display name.
        $groups = [];
        foreach ($rows as $row) {
            $key = $this->normalise($row->referred_by);
            if ($key === '' || $this->isPrivateMarker($key)) {
                continue;
            }
            $groups[$key]['variants'][] = ['name' => $row->referred_by, 'n' => (int) $row->n];
            $groups[$key]['total'] = ($groups[$key]['total'] ?? 0) + (int) $row->n;
        }

        // One read for the whole table beats one read per group.
        $this->loadCompanies();

        $report = [];
        foreach ($groups as $key => $group) {
            $name = Names::display($group['variants']);
            $existing = $this->companies[$key] ?? null;

            if ($existing) {
                $this->stats['companiesMatched']++;
                $report[$key] = ['name' => $existing->name, 'applications' => $group['total'], 'created' => false];

                continue;
            }

            if ($this->dryRun) {
                $report[$key] = ['name' => $name, 'applications' => $group['total'], 'created' => true];
                $this->stats['companiesCreated']++;

                continue;
            }

            $company = Company::create([
                'uid' => $this->uniqueCompanyUid($name),
                'name' => $name,
                'status' => Company::STATUS_ACTIVE,
                'notes' => 'Referral source imported from the CBI caseload.',
                'created_by' => $this->actor?->id,
            ]);

            $this->companies[$key] = $company;
            $this->stats['companiesCreated']++;
            $report[$key] = ['name' => $name, 'applications' => $group['total'], 'created' => true];
        }

        return $report;
    }

    /**
     * Give every CBI-linked client a File Library folder if they do not have one.
     *
     * importClients() only provisions folders for applicants it creates. The
     * caseload was imported earlier without --folders, so thousands of linked
     * people have a Client hub record and nowhere for their paperwork to land.
     *
     * Batched the same way as importClients(): the remote DB is ~400ms away, so
     * calling FolderProvisioner once per client would take hours. One name-set
     * load, batch inserts, and a CASE update finish the same work in minutes.
     */
    public function provisionMissingFolders(?callable $progress = null, int $batchSize = 500): int
    {
        if (! $this->actor && ! $this->dryRun) {
            return 0;
        }

        if ($this->dryRun) {
            $n = Client::query()
                ->whereNull('folder_id')
                ->whereIn('id', CbiApplication::query()->whereNotNull('client_id')->select('client_id'))
                ->count();
            $this->stats['foldersCreated'] += $n;
            if ($progress) {
                for ($i = 0; $i < $n; $i++) {
                    $progress();
                }
            }

            return $n;
        }

        $root = FolderProvisioner::clientsRoot();
        $ownerId = $this->actor->id;
        $now = now();
        $subfolders = FileLibrarySetting::clientSubfolders();

        // Sibling names under Client Files, lowercased, so uniqueness is
        // settled in memory instead of one EXISTS round trip per person.
        $taken = Folder::query()
            ->where('parent_id', $root->id)
            ->pluck('name')
            ->mapWithKeys(fn ($name) => [mb_strtolower((string) $name) => true])
            ->all();

        $created = 0;
        $batch = [];

        $flush = function () use (&$batch, &$created, $root, $ownerId, $now, $subfolders, $progress) {
            if ($batch === []) {
                return;
            }

            $folderIdsByUuid = [];

            DB::transaction(function () use (&$batch, &$folderIdsByUuid, $root, $ownerId, $now) {
                $rows = [];
                foreach ($batch as $item) {
                    $rows[] = [
                        'uuid' => $item['uuid'],
                        'name' => $item['name'],
                        'folder_type' => Folder::TYPE_CLIENT,
                        'client_id' => $item['client_id'],
                        'parent_id' => $root->id,
                        'owner_id' => $ownerId,
                        'created_by' => $ownerId,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
                DB::table('folders')->insert($rows);

                $folderIdsByUuid = DB::table('folders')
                    ->whereIn('uuid', array_column($batch, 'uuid'))
                    ->pluck('id', 'uuid')
                    ->all();

                $case = 'CASE id';
                $clientIds = [];
                foreach ($batch as $item) {
                    $folderId = $folderIdsByUuid[$item['uuid']] ?? null;
                    if ($folderId === null) {
                        continue;
                    }
                    $case .= ' WHEN '.(int) $item['client_id'].' THEN '.(int) $folderId;
                    $clientIds[] = (int) $item['client_id'];
                }
                $case .= ' END';

                if ($clientIds !== []) {
                    $idList = implode(',', $clientIds);
                    DB::update("UPDATE clients SET folder_id = {$case}, updated_at = '{$now->toDateTimeString()}' WHERE id IN ({$idList})");
                }
            });

            if ($subfolders !== []) {
                $subRows = [];
                foreach ($batch as $item) {
                    $folderId = (int) ($folderIdsByUuid[$item['uuid']] ?? 0);
                    if (! $folderId) {
                        continue;
                    }
                    foreach ($subfolders as $sub) {
                        $clean = Naming::clean((string) $sub);
                        if ($clean === '') {
                            continue;
                        }
                        $subRows[] = [
                            'uuid' => (string) Str::uuid(),
                            'name' => $clean,
                            'folder_type' => Folder::TYPE_USER,
                            'parent_id' => $folderId,
                            'owner_id' => $ownerId,
                            'created_by' => $ownerId,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    }
                }
                foreach (array_chunk($subRows, 500) as $chunk) {
                    DB::table('folders')->insert($chunk);
                }
            }

            $n = count($batch);
            $created += $n;
            $this->stats['foldersCreated'] += $n;
            if ($progress) {
                for ($i = 0; $i < $n; $i++) {
                    $progress();
                }
            }
            $batch = [];
        };

        Client::query()
            ->whereNull('folder_id')
            ->whereIn('id', CbiApplication::query()->whereNotNull('client_id')->select('client_id'))
            ->orderBy('id')
            ->chunkById($batchSize, function ($clients) use (&$batch, &$taken, $flush, $batchSize) {
                foreach ($clients as $client) {
                    $base = Naming::clean($client->name ?: 'Client') ?: 'Client';
                    $name = $base;
                    $n = 2;
                    while (isset($taken[mb_strtolower($name)])) {
                        $name = $base.' ('.$n.')';
                        $n++;
                    }
                    $taken[mb_strtolower($name)] = true;

                    $batch[] = [
                        'uuid' => (string) Str::uuid(),
                        'name' => $name,
                        'client_id' => $client->id,
                    ];

                    if (count($batch) >= $batchSize) {
                        $flush();
                    }
                }
            });

        $flush();

        return $created;
    }

    /**
     * Create a client for every applicant that does not have one yet.
     *
     * Written in batches, and that is the whole design. The production
     * database is a remote serverless Postgres about 400ms away, so the cost
     * of this import is round trips, not rows: a per-row insert plus a uid
     * check plus a link update is three round trips each, which put eleven
     * thousand applicants several hours away. A batch of 500 costs four round
     * trips in total, and the same work lands in about a minute.
     *
     * Uid uniqueness therefore has to be settled in memory, every existing
     * uid is read once up front, and each new one joins the set as it is
     * minted, so no row asks the database whether its own name is free.
     */
    public function importClients(?callable $progress = null, int $batchSize = 500): void
    {
        // registerCompanies() may not have run in this process (a resumed run,
        // or clients-only); either way the map has to be complete before a
        // client can be pointed at a referrer.
        if ($this->companies === []) {
            $this->loadCompanies();
        }

        if (! $this->dryRun) {
            $this->takenUids = Client::withTrashed()->pluck('uid')->flip()->all();
        }

        $batch = [];
        CbiApplication::query()
            ->whereNull('client_id')
            ->orderBy('id')
            ->chunkById($batchSize, function ($applications) use (&$batch, $progress, $batchSize) {
                foreach ($applications as $application) {
                    $row = $this->rowFor($application);
                    if ($row !== null) {
                        $batch[] = $row;
                    }
                    if ($progress) {
                        $progress();
                    }
                }

                if (count($batch) >= $batchSize) {
                    $this->flush($batch);
                    $batch = [];
                }
            });

        if ($batch !== []) {
            $this->flush($batch);
        }
    }

    /**
     * Build one client row, or null where there is nothing to file a person
     * under. Touches no database.
     *
     * @return array{applicationId: int, columns: array<string, mixed>}|null
     */
    private function rowFor(CbiApplication $application): ?array
    {
        $name = trim((string) $application->applicant_name);
        if ($name === '') {
            // Left unlinked on purpose so a later sync that fills the name in
            // will pick it up.
            $this->stats['unnamed']++;
            $this->stats['clientsSkipped']++;

            return null;
        }

        $referral = $this->referralFor($application->referred_by);
        $this->stats['clientsCreated']++;

        if ($this->dryRun) {
            return null;
        }

        $now = now();

        return [
            'applicationId' => $application->id,
            'columns' => [
                'uid' => $this->mintClientUid($name, $application),
                'name' => $name,
                'client_type' => 'private',
                'referral_type' => $referral['type'],
                'referred_by_company_id' => $referral['company']?->id,
                // The employer column stays empty: a referrer is not an
                // employer, and the caseload says nothing about who these
                // people work for.
                'company' => null,
                'company_id' => null,
                'initial' => mb_strtoupper(mb_substr($name, 0, 1)),
                'initial_color' => 'blue',
                'data' => json_encode($this->profileFor($application, $name)),
                'created_by' => $this->actor?->id,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ];
    }

    /**
     * Write one batch: insert the clients, read back the ids their uids were
     * given, then point each application at its client in a single statement.
     *
     * @param  array<int, array{applicationId: int, columns: array<string, mixed>}>  $batch
     */
    private function flush(array $batch): void
    {
        if ($batch === []) {
            return;
        }

        $uids = array_column(array_column($batch, 'columns'), 'uid');

        /*
         * Insert and link together or not at all. Separately, a failure
         * between the two leaves clients nobody points at, and because their
         * applications are still unlinked, the next run would import the same
         * people again. The batch is the unit of work, so it is the
         * transaction.
         */
        DB::transaction(function () use ($batch, $uids) {
            DB::table('clients')->insert(array_column($batch, 'columns'));

            // The uid is what the insert and the read-back have in common; it
            // is unique, so this cannot pick up somebody else's row.
            $ids = DB::table('clients')->whereIn('uid', $uids)->pluck('id', 'uid');

            $links = [];
            foreach ($batch as $row) {
                $id = $ids[$row['columns']['uid']] ?? null;
                if ($id !== null) {
                    $links[$row['applicationId']] = $id;
                }
            }

            $this->linkApplications($links);
        });

        if (! $this->withFolders || ! $this->actor) {
            return;
        }

        // Opt-in, and deliberately not batched: the provisioner owns folder
        // naming, nesting and the configured default subfolders, and
        // reimplementing that here to save round trips would fork it.
        foreach (Client::whereIn('uid', $uids)->get() as $client) {
            FolderProvisioner::provisionClientFolder($client, $this->actor);
            $this->stats['foldersCreated']++;
        }
    }

    /**
     * One UPDATE for the whole batch. A `CASE id WHEN … THEN …` is the
     * portable way to give every row a different value in a single statement;
     * five hundred separate updates would be five hundred round trips, which
     * is the cost this class exists to avoid.
     *
     * @param  array<int, int>  $links  application id => client id
     */
    private function linkApplications(array $links): void
    {
        if ($links === []) {
            return;
        }

        /*
         * The ids are cast to int and written into the statement rather than
         * bound. Both sides are primary keys this class has just read from the
         * database, so an (int) cast leaves nothing a string could smuggle
         * through, and bound placeholders are actively wrong here: Postgres
         * cannot infer a type for `WHEN ? THEN ?` and reads them as text,
         * which fails against a bigint column. SQLite does not care, so the
         * test suite would never have caught it.
         */
        $case = 'CASE id';
        foreach ($links as $applicationId => $clientId) {
            $case .= ' WHEN '.(int) $applicationId.' THEN '.(int) $clientId;
        }
        $case .= ' END';

        $ids = implode(',', array_map('intval', array_keys($links)));

        DB::update("UPDATE cbi_applications SET client_id = {$case} WHERE id IN ({$ids})");
    }

    /**
     * @return array{type: string, company: ?Company}
     */
    private function referralFor(?string $referredBy): array
    {
        $key = $this->normalise((string) $referredBy);

        if ($key === '') {
            $this->stats['noReferral']++;

            return ['type' => Client::REFERRAL_NONE, 'company' => null];
        }

        if ($this->isPrivateMarker($key)) {
            $this->stats['private']++;

            return ['type' => Client::REFERRAL_PRIVATE, 'company' => null];
        }

        $company = $this->companies[$key] ?? null;

        // A source that never became a company (registerCompanies was skipped,
        // or it arrived between the two passes) is recorded as unknown rather
        // than silently dropped into "private".
        return $company
            ? ['type' => Client::REFERRAL_COMPANY, 'company' => $company]
            : ['type' => Client::REFERRAL_NONE, 'company' => null];
    }

    /**
     * The contact record. Only what the caseload actually holds, the CBI
     * sheets carry no addresses, emails or phone numbers, and inventing empty
     * collections would make every imported client look half filled in.
     *
     * @return array<string, mixed>
     */
    private function profileFor(CbiApplication $application, string $name): array
    {
        $parts = preg_split('/\s+/', $name) ?: [$name];
        $profile = [
            'firstName' => $parts[0] ?? $name,
            'lastName' => count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : '',
            'notes' => 'Imported from the CBI caseload.',
            // Where the detail lives. The application is the record of truth
            // for the case; the client is the record of truth for the person.
            'cbi' => array_filter([
                'applicationUuid' => $application->uuid,
                'applicantNumber' => $application->applicant_number,
                'stage' => $application->stage,
                'status' => $application->status,
                'investmentOption' => $application->investment_option,
                'assignedTo' => $application->assigned_to,
                'receivedAt' => $application->received_at?->toDateString(),
                'referredByAsTyped' => $application->referred_by,
            ], fn ($v) => $v !== null && $v !== ''),
        ];

        if ($application->date_of_birth) {
            $profile['importantDates'] = [[
                'type' => 'birthday',
                'label' => '',
                'date' => $application->date_of_birth->toDateString(),
            ]];
        }

        return $profile;
    }

    /** Load already-registered companies so a clients-only run can still link. */
    private function loadCompanies(): void
    {
        foreach (Company::all() as $company) {
            $this->companies[$this->normalise($company->name)] ??= $company;
        }
    }

    private function normalise(string $value): string
    {
        return Names::normalise($value);
    }

    private function isPrivateMarker(string $normalised): bool
    {
        return in_array($normalised, self::PRIVATE_MARKERS, true);
    }

    /**
     * Only ~60 of these, so the round trips do not matter and the clarity of
     * asking the database does.
     */
    private function uniqueCompanyUid(string $name): string
    {
        $base = trim(Str::slug($name) ?: 'company', '-') ?: 'company';
        $uid = $base;
        $n = 2;
        while (Company::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$n;
            $n++;
        }

        return $uid;
    }

    /**
     * Applicant names repeat, so the number disambiguates where there is one.
     * The uid is public (it is the /clients URL), which is why it is built
     * from the name rather than the application's uuid.
     *
     * Settled against the in-memory set rather than the database: eleven
     * thousand existence checks at 400ms each is most of an afternoon, and the
     * set holds every uid already taken plus every one minted in this run.
     */
    private function mintClientUid(string $name, CbiApplication $application): string
    {
        $base = Str::slug($name) ?: 'client';
        if ($application->applicant_number) {
            $suffix = Str::slug($application->applicant_number);
            if ($suffix !== '') {
                $base .= '-'.$suffix;
            }
        }

        $base = trim(Str::limit($base, 80, ''), '-') ?: 'client';
        $uid = $base;
        $n = 2;
        while (isset($this->takenUids[$uid])) {
            $uid = $base.'-'.$n;
            $n++;
        }

        $this->takenUids[$uid] = true;

        return $uid;
    }
}
