<?php

namespace App\Support\Cbi;

use App\Models\CbiApplication;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use Illuminate\Support\Str;

/**
 * Brings the CBI caseload into the Client hub.
 *
 * The applications arrive from Smartsheet, where "Referred By" is free text
 * typed by whoever opened the file. So the hub gets two things out of one
 * pass: a registered company for every distinct referral source, and a client
 * record for every applicant, linked to the company that sent them.
 *
 * Two properties matter more than speed. It is **idempotent** — an application
 * already pointing at a client is left alone — so it can run after every sync.
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
     * a single client points at one — the order the office asked for, and the
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

        $report = [];
        foreach ($groups as $key => $group) {
            $name = $this->displayName($group['variants']);
            $existing = Company::whereRaw('LOWER(name) = ?', [$key])->first();

            if ($existing) {
                $this->companies[$key] = $existing;
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
     * Create a client for every applicant that does not have one yet.
     *
     * Chunked by id: eleven thousand applications will not fit in memory
     * alongside their clients, and the link column means a run interrupted
     * half way can simply be started again.
     */
    public function importClients(?callable $progress = null): void
    {
        // registerCompanies() may not have run in this process (a resumed run,
        // or clients-only); either way the map has to be complete before a
        // client can be pointed at a referrer.
        if ($this->companies === []) {
            $this->loadCompanies();
        }

        CbiApplication::query()
            ->whereNull('client_id')
            ->orderBy('id')
            ->chunkById(200, function ($applications) use ($progress) {
                foreach ($applications as $application) {
                    $this->importOne($application);
                    if ($progress) {
                        $progress();
                    }
                }
            });
    }

    private function importOne(CbiApplication $application): void
    {
        $name = trim((string) $application->applicant_name);
        if ($name === '') {
            // Nothing to file a person under. Left unlinked on purpose so a
            // later sync that fills the name in will pick it up.
            $this->stats['unnamed']++;
            $this->stats['clientsSkipped']++;

            return;
        }

        $referral = $this->referralFor($application->referred_by);

        if ($this->dryRun) {
            $this->stats['clientsCreated']++;

            return;
        }

        $client = Client::create([
            'uid' => $this->uniqueClientUid($name, $application),
            'name' => $name,
            'client_type' => 'private',
            'referral_type' => $referral['type'],
            'referred_by_company_id' => $referral['company']?->id,
            // The employer column stays empty: a referrer is not an employer,
            // and the caseload says nothing about who these people work for.
            'company' => null,
            'company_id' => null,
            'initial' => mb_strtoupper(mb_substr($name, 0, 1)),
            'initial_color' => 'blue',
            'data' => $this->profileFor($application, $name),
            'created_by' => $this->actor?->id,
        ]);

        $application->forceFill(['client_id' => $client->id])->saveQuietly();
        $this->stats['clientsCreated']++;

        // Off by default: eleven thousand main folders and their configured
        // subfolders is a far bigger write than the directory itself.
        if ($this->withFolders && $this->actor) {
            FolderProvisioner::provisionClientFolder($client, $this->actor);
            $this->stats['foldersCreated']++;
        }
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
     * The contact record. Only what the caseload actually holds — the CBI
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
            $this->companies[$this->normalise($company->name)] = $company;
        }
    }

    /**
     * Which spelling of a referral source to show.
     *
     * Prefer a variant that someone typed in mixed case — it is the readable
     * one. Where every variant is shouted, keep it shouted: upper case is as
     * likely to be an acronym (GCC, RIF Trust) as a stuck caps lock, and
     * title-casing an acronym is a worse error than leaving it alone.
     *
     * @param  array<int, array{name: string, n: int}>  $variants
     */
    private function displayName(array $variants): string
    {
        usort($variants, fn ($a, $b) => $b['n'] <=> $a['n']);

        foreach ($variants as $variant) {
            $name = $this->tidy($variant['name']);
            // Mixed case means somebody typed it deliberately: it differs from
            // both its shouted and its whispered form. All-lower is a stuck
            // shift key, not a choice, so it does not win.
            if ($name !== mb_strtoupper($name) && $name !== mb_strtolower($name)) {
                return $name;
            }
        }

        $fallback = $this->tidy($variants[0]['name']);

        // Nothing but lower case: title-case it, since no acronym is written
        // that way. Nothing but upper case: leave it, because GCC and RIF are
        // as likely as a stuck caps lock and mangling those is the worse error.
        return $fallback === mb_strtolower($fallback)
            ? mb_convert_case($fallback, MB_CASE_TITLE, 'UTF-8')
            : $fallback;
    }

    private function tidy(string $value): string
    {
        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }

    private function normalise(string $value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/', ' ', $value) ?? ''));
    }

    private function isPrivateMarker(string $normalised): bool
    {
        return in_array($normalised, self::PRIVATE_MARKERS, true);
    }

    private function uniqueCompanyUid(string $name): string
    {
        return $this->uniqueUid(Str::slug($name) ?: 'company', Company::class);
    }

    /**
     * Applicant names repeat, so the number disambiguates where there is one.
     * The uid is public (it is the /clients URL), which is why it is built
     * from the name rather than the application's uuid.
     */
    private function uniqueClientUid(string $name, CbiApplication $application): string
    {
        $base = Str::slug($name) ?: 'client';
        if ($application->applicant_number) {
            $suffix = Str::slug($application->applicant_number);
            if ($suffix !== '') {
                $base .= '-'.$suffix;
            }
        }

        return $this->uniqueUid(Str::limit($base, 80, ''), Client::class);
    }

    /** @param  class-string<\Illuminate\Database\Eloquent\Model>  $model */
    private function uniqueUid(string $base, string $model): string
    {
        $base = trim($base, '-') ?: 'record';
        $uid = $base;
        $n = 2;
        while ($model::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$n;
            $n++;
        }

        return $uid;
    }
}
