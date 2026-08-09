<?php

namespace Tests\Feature;

use App\Models\CbiApplication;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Cbi\ClientHubImporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Bringing the CBI caseload into the Client hub.
 *
 * The interesting cases are all in the data rather than the code: "Referred
 * By" is free text, so the same firm arrives shouted, typed properly, and
 * padded with spaces, and "PRIVATE" arrives looking like a company.
 */
class CbiClientHubImportTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
        ]);
    }

    private function application(?string $referredBy, ?string $name, ?string $number = null): CbiApplication
    {
        return CbiApplication::create([
            'dedupe_key' => 'k'.uniqid(),
            'applicant_name' => $name,
            'applicant_number' => $number,
            'referred_by' => $referredBy,
            'stage' => 'applications',
        ]);
    }

    public function test_spellings_of_one_referral_source_become_one_company(): void
    {
        $staff = $this->staff();
        $this->application('GALAXY', 'A One');
        $this->application('Galaxy', 'B Two');
        $this->application('  galaxy  ', 'C Three');

        (new ClientHubImporter($staff))->registerCompanies();

        $this->assertSame(1, Company::count());
        // The variant somebody typed deliberately wins the display name.
        $this->assertSame('Galaxy', Company::first()->name);
    }

    public function test_an_all_caps_source_keeps_its_case_but_an_all_lower_one_is_tidied(): void
    {
        $staff = $this->staff();
        // Shouted could be an acronym; mangling GCC into Gcc is the worse error.
        $this->application('GCC', 'A One');
        $this->application('soland', 'B Two');

        (new ClientHubImporter($staff))->registerCompanies();

        $this->assertNotNull(Company::where('name', 'GCC')->first());
        $this->assertNotNull(Company::where('name', 'Soland')->first());
    }

    public function test_it_reuses_a_company_that_is_already_registered(): void
    {
        $staff = $this->staff();
        Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $this->application('GALAXY', 'A One');

        $importer = new ClientHubImporter($staff);
        $importer->registerCompanies();
        $importer->importClients();

        $this->assertSame(1, Company::count());
        $this->assertSame('Galaxy', Client::first()->referredByCompany->name);
    }

    public function test_applicants_become_clients_linked_to_their_referrer(): void
    {
        $staff = $this->staff();
        $this->application('BLUEMINA', 'Akram Issa', 'CBI-1');

        $importer = new ClientHubImporter($staff);
        $importer->registerCompanies();
        $importer->importClients();

        $client = Client::where('name', 'Akram Issa')->firstOrFail();
        $this->assertSame('private', $client->client_type);
        $this->assertSame(Client::REFERRAL_COMPANY, $client->referral_type);
        // Only ever seen shouted, so it stays shouted — see the acronym case.
        $this->assertSame('BLUEMINA', $client->referredByCompany->name);
        // A referral is not employment: the company columns stay empty.
        $this->assertNull($client->company_id);
        $this->assertNull($client->company);
        // And the case points back at the person.
        $this->assertSame($client->id, CbiApplication::first()->client_id);
        $this->assertSame('CBI-1', $client->data['cbi']['applicantNumber']);
    }

    public function test_private_is_an_answer_and_a_blank_is_not(): void
    {
        $staff = $this->staff();
        $this->application('PRIVATE', 'Jane Smith');
        $this->application(null, 'Sarah Charles');

        $importer = new ClientHubImporter($staff);
        $importer->registerCompanies();
        $importer->importClients();

        // "PRIVATE" must not be registered as a firm called Private.
        $this->assertSame(0, Company::count());
        $this->assertSame(Client::REFERRAL_PRIVATE, Client::where('name', 'Jane Smith')->first()->referral_type);
        $this->assertSame(Client::REFERRAL_NONE, Client::where('name', 'Sarah Charles')->first()->referral_type);
    }

    public function test_a_row_with_no_applicant_name_is_left_for_a_later_sync(): void
    {
        $staff = $this->staff();
        $this->application('GALAXY', null);

        $importer = new ClientHubImporter($staff);
        $importer->registerCompanies();
        $importer->importClients();

        $this->assertSame(0, Client::count());
        // Still unlinked, so filling the name in later brings it through.
        $this->assertNull(CbiApplication::first()->client_id);
        $this->assertSame(1, $importer->stats['unnamed']);
    }

    public function test_two_applicants_of_the_same_name_get_their_own_records(): void
    {
        $staff = $this->staff();
        $this->application('SOLAND', 'Ali Hassan', 'CBI-1');
        $this->application('SOLAND', 'Ali Hassan', 'CBI-2');

        $importer = new ClientHubImporter($staff);
        $importer->registerCompanies();
        $importer->importClients();

        $this->assertSame(2, Client::count());
        $this->assertSame(2, Client::distinct('uid')->count('uid'));
    }

    public function test_running_it_again_changes_nothing(): void
    {
        $staff = $this->staff();
        $this->application('GALAXY', 'A One');
        $this->application('PRIVATE', 'B Two');

        $first = new ClientHubImporter($staff);
        $first->registerCompanies();
        $first->importClients();

        $second = new ClientHubImporter($staff);
        $second->registerCompanies();
        $second->importClients();

        $this->assertSame(2, Client::count());
        $this->assertSame(1, Company::count());
        $this->assertSame(0, $second->stats['clientsCreated']);
        $this->assertSame(0, $second->stats['companiesCreated']);
    }

    public function test_it_spans_batches_without_losing_or_crossing_links(): void
    {
        $staff = $this->staff();
        // Deliberately more rows than a batch holds, all sharing one name so
        // the uid set has to stay coherent across flushes, and one nameless
        // row mid-run so the batch boundaries do not line up with the chunks.
        for ($i = 1; $i <= 7; $i++) {
            $this->application('GALAXY', 'Ali Hassan', 'CBI-'.$i);
        }
        $this->application('GALAXY', null, 'CBI-blank');

        $importer = new ClientHubImporter($staff);
        $importer->registerCompanies();
        $importer->importClients(batchSize: 3);

        $this->assertSame(7, Client::count());
        $this->assertSame(7, Client::distinct('uid')->count('uid'));

        // Every named application points at its own client, and no two share.
        $linked = CbiApplication::whereNotNull('client_id')->pluck('client_id', 'applicant_number');
        $this->assertCount(7, $linked);
        $this->assertCount(7, array_unique($linked->all()));
        $this->assertNull(CbiApplication::where('applicant_number', 'CBI-blank')->first()->client_id);

        // And the link is to the right person, not merely to some client.
        foreach ($linked as $number => $clientId) {
            $this->assertSame($number, Client::find($clientId)->data['cbi']['applicantNumber']);
        }
    }

    public function test_a_second_run_finishes_what_an_interrupted_one_started(): void
    {
        $staff = $this->staff();
        for ($i = 1; $i <= 5; $i++) {
            $this->application('GALAXY', 'Person '.$i, 'CBI-'.$i);
        }

        // Stand in for a run killed part way: two applications already linked.
        $first = new ClientHubImporter($staff);
        $first->registerCompanies();
        $first->importClients(batchSize: 2);
        CbiApplication::orderByDesc('id')->limit(3)->get()
            ->each(function ($a) {
                $a->client->forceDelete();
                $a->forceFill(['client_id' => null])->saveQuietly();
            });
        $this->assertSame(2, Client::count());

        (new ClientHubImporter($staff))->importClients();

        $this->assertSame(5, Client::count());
        $this->assertSame(0, CbiApplication::whereNull('client_id')->count());
        $this->assertSame(5, Client::distinct('uid')->count('uid'));
    }

    public function test_a_dry_run_writes_nothing(): void
    {
        $staff = $this->staff();
        $this->application('GALAXY', 'A One');

        $importer = new ClientHubImporter($staff, dryRun: true);
        $importer->registerCompanies();
        $importer->importClients();

        $this->assertSame(0, Company::count());
        $this->assertSame(0, Client::count());
        // But it still reports what a real run would do.
        $this->assertSame(1, $importer->stats['companiesCreated']);
        $this->assertSame(1, $importer->stats['clientsCreated']);
    }

    public function test_the_command_runs_end_to_end(): void
    {
        $staff = $this->staff();
        $this->application('GALAXY', 'A One');

        $this->artisan('cbi:import-clients', ['--actor' => $staff->email])
            ->assertExitCode(0);

        $this->assertSame(1, Client::count());
        $this->assertSame(1, Company::count());
    }
}
