<?php

namespace Tests\Feature;

use App\Models\CbiApplication;
use App\Models\CbiApplicationEvent;
use App\Models\CbiComment;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Cutover;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use App\Support\Cip\Timeline;
use App\Support\Imports\ImportPause;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Phase 11c — Smartsheet / CBI cutover into native CIP records.
 */
class CipCutoverTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Mail::fake();
        ImportPause::flush();
    }

    protected function tearDown(): void
    {
        ImportPause::flush();
        parent::tearDown();
    }

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'name' => 'Ada Admin',
        ]);
    }

    private function officer(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'name' => 'Rita Officer',
        ]);
    }

    private function galaxy(): CipProvider
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        return CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
    }

    private function cbi(array $overrides = []): CbiApplication
    {
        return CbiApplication::create(array_merge([
            'dedupe_key' => 'k'.uniqid(),
            'applicant_name' => 'Chen Wei',
            'applicant_number' => '10T1G12661P',
            'referred_by' => 'Galaxy',
            'stage' => CbiApplication::STAGE_ASSESSMENT,
            'status' => 'BACKGROUND CHECK',
            'investment_option' => 'Real Estate Project',
        ], $overrides));
    }

    public function test_a_mirror_row_becomes_a_native_application(): void
    {
        $this->galaxy();
        $officer = $this->officer();
        $client = Client::create([
            'uid' => 'chen-wei',
            'name' => 'Chen Wei',
            'client_type' => 'private',
            'data' => [],
        ]);
        $row = $this->cbi([
            'client_id' => $client->id,
            'assigned_user_id' => $officer->id,
            'submitted_at' => '2026-01-15',
            'accepted_at' => '2026-02-01',
        ]);

        CbiComment::create([
            'application_id' => $row->id,
            'author_name' => 'Dincel Baptiste',
            'body' => 'Waiting on the police certificate.',
            'commented_at' => '2026-02-03 10:00:00',
        ]);
        CbiApplicationEvent::create([
            'application_id' => $row->id,
            'type' => CbiApplicationEvent::TYPE_STATUS_CHANGED,
            'from_value' => 'PENDING REVIEW',
            'to_value' => 'BACKGROUND CHECK',
            'actor_name' => 'Ada Admin',
            'occurred_at' => '2026-02-01 09:00:00',
        ]);

        $stats = (new Cutover)->run();

        $this->assertSame(1, $stats['migrated']);
        $application = CipApplication::where('cbi_application_id', $row->id)->firstOrFail();
        $this->assertSame(Status::BACKGROUND_CHECK, $application->status);
        $this->assertSame(InvestmentType::REAL_ESTATE, $application->investment_type);
        $this->assertSame('10T1G12661P', $application->cip_number);
        $this->assertSame('10T1G12661P', $application->displayNumber());
        $this->assertNotNull($application->internal_number);
        $this->assertSame($officer->id, $application->assigned_officer_id);
        $this->assertSame($client->id, $application->client_id);
        $this->assertSame('2026-01-15', $application->submitted_at?->toDateString());
        $this->assertSame('2026-02-01', $application->accepted_at?->toDateString());

        $person = CipPerson::where('application_id', $application->id)->firstOrFail();
        $this->assertSame(CipPerson::ROLE_MAIN_APPLICANT, $person->role);
        $this->assertSame('Chen', $person->first_name);
        $this->assertSame('Wei', $person->last_name);

        $this->assertSame(
            $application->uuid,
            $client->fresh()->data['cip']['applicationUuid'],
        );

        $note = CipApplicationMessage::where('application_id', $application->id)->firstOrFail();
        $this->assertSame(CipApplicationMessage::LANE_INTERNAL, $note->lane);
        $this->assertSame('Waiting on the police certificate.', $note->body);

        $history = Timeline::for($application, $this->admin());
        $this->assertTrue(collect($history)->contains(
            fn ($line) => str_contains(strtolower($line['what']), 'imported this file from the smartsheet caseload'),
        ));
        $this->assertTrue(collect($history)->contains(
            fn ($line) => $line['action'] === CipEvent::ACTION_STATUS_CHANGED
                && str_contains($line['what'], 'Background Check'),
        ));

        Mail::assertNothingOutgoing();
    }

    public function test_post_approval_dates_win_over_a_stale_sheet_status(): void
    {
        $this->galaxy();
        $this->cbi([
            'status' => 'BACKGROUND CHECK',
            'granted' => true,
            'decision_received_at' => '2025-11-01',
            'cor_submitted_at' => '2025-11-20',
        ]);

        (new Cutover)->run();

        $application = CipApplication::first();
        $this->assertSame(Status::PENDING_COR, $application->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->decision);
        $this->assertSame('2025-11-01', $application->decided_at?->toDateString());
    }

    public function test_needs_review_rows_are_left_alone_unless_asked(): void
    {
        $this->galaxy();
        $this->cbi(['needs_review' => true, 'applicant_name' => 'Ambiguous One']);

        $skipped = (new Cutover)->run();
        $this->assertSame(0, $skipped['migrated']);
        $this->assertSame(1, $skipped['skippedNeedsReview']);
        $this->assertSame(0, CipApplication::count());

        $included = (new Cutover(includeNeedsReview: true))->run();
        $this->assertSame(1, $included['migrated']);
        $this->assertSame(1, CipApplication::count());
    }

    public function test_unmatched_providers_are_skipped(): void
    {
        $this->cbi(['referred_by' => 'A firm with no CIP code']);

        $stats = (new Cutover)->run();
        $this->assertSame(0, $stats['migrated']);
        $this->assertSame(1, $stats['skippedNoProvider']);
        $this->assertSame(0, CipApplication::count());
    }

    public function test_private_referrals_file_under_pri(): void
    {
        CipProvider::create(['name' => 'Private Clients', 'code' => 'PRI']);
        $this->cbi(['referred_by' => 'PRIVATE']);

        (new Cutover)->run();

        $this->assertSame('PRI', CipApplication::first()->provider->code);
    }

    public function test_it_is_idempotent(): void
    {
        $this->galaxy();
        $this->cbi();

        $first = (new Cutover)->run();
        $second = (new Cutover)->run();

        $this->assertSame(1, $first['migrated']);
        $this->assertSame(0, $second['migrated']);
        $this->assertSame(1, $second['skippedAlready']);
        $this->assertSame(1, CipApplication::count());
    }

    public function test_a_dry_run_writes_nothing(): void
    {
        $this->galaxy();
        $this->cbi();

        $stats = (new Cutover(dryRun: true))->run();

        $this->assertSame(1, $stats['migrated']);
        $this->assertSame(0, CipApplication::count());
        $this->assertSame(0, CipEvent::count());
    }

    public function test_cbi_bookmarks_redirect_to_cip_applications(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->admin();

        $this->actingAs($admin)->get('/cbi')->assertRedirect('/citizenship-applications');
        $this->actingAs($admin)->get('/dev/cbi')->assertOk();
    }

    public function test_the_cbi_listing_stays_when_cip_is_off(): void
    {
        config([
            'services.cip.enabled' => false,
            'services.smartsheet.cbi_enabled' => true,
        ]);
        $admin = $this->admin();

        $this->actingAs($admin)->get('/cbi')->assertOk();
        $this->actingAs($admin)->get('/dev/cbi')->assertOk();
    }

    public function test_the_command_refuses_to_run_while_cip_is_dark(): void
    {
        config(['services.cip.enabled' => false]);

        $this->artisan('cip:cutover')->assertFailed();
    }

    public function test_the_command_pauses_smartsheet_sync(): void
    {
        $this->artisan('cip:cutover', ['--pause' => true])->assertSuccessful();

        ImportPause::flush();
        $this->assertTrue(ImportPause::smartsheet());
    }

    public function test_status_and_investment_maps(): void
    {
        $this->assertSame(Status::NEW, Cutover::statusOf($this->cbi(['status' => 'NEW'])));
        $this->assertSame(Status::REVIEW_APPLICATION, Cutover::statusOf($this->cbi(['status' => 'APPLICATION REVIEW'])));
        $this->assertSame(Status::READY_TO_SUBMIT, Cutover::statusOf($this->cbi(['status' => 'TO SUBMIT'])));
        $this->assertSame(Status::PENDING_REVIEW, Cutover::statusOf($this->cbi(['status' => 'PENDING REVIEW'])));
        $this->assertSame(Status::DENIED, Cutover::statusOf($this->cbi(['status' => 'DENIED'])));
        $this->assertSame(Status::GRANTED, Cutover::statusOf($this->cbi(['status' => 'GRANTED', 'granted' => true])));

        $this->assertSame(
            InvestmentType::NATIONAL_ECONOMIC_FUND,
            Cutover::investmentOf($this->cbi(['investment_option' => 'NEF Donation']))['type'],
        );
        $this->assertSame(
            InvestmentType::OTHER,
            Cutover::investmentOf($this->cbi(['investment_option' => 'Sugar factory']))['type'],
        );
    }
}
