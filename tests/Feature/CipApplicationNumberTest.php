<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use App\Support\Cip\Submission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * §7 — the two application numbers, and the rule that switches between them.
 *
 * The internal number is ours and permanent; the CIP number is the Unit's and
 * arrives at submission. What is pinned here is the switching rule itself: one
 * write, and every surface that renders `displayNumber()` moves with it, while
 * the internal number stays stored and findable for audit and invoicing.
 */
class CipApplicationNumberTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $email = 'ada@example.com', string $name = 'Ada Admin'): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function provider(User $owner, string $code = 'GAL', string $name = 'Galaxy'): CipProvider
    {
        $company = Company::create(['uid' => strtolower($code), 'name' => $name, 'created_by' => $owner->id]);

        return CipProvider::create(['name' => $name, 'code' => $code, 'company_id' => $company->id]);
    }

    /** An application parked at Ready to submit, which is where §16 begins. */
    private function ready(User $staff, CipProvider $provider, string $clientName = 'Chen Wei'): CipApplication
    {
        $application = Applications::create($provider, $staff);

        $client = Client::create([
            'uid' => \Illuminate\Support\Str::slug($clientName).'-'.strtolower($application->internal_number),
            'name' => $clientName, 'created_by' => $staff->id, 'data' => [],
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        foreach ([Status::REVIEW_APPLICATION, Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT] as $to) {
            Engine::apply($application, $to, $staff);
        }

        // §16 begins after the provider has confirmed: the original package
        // is frozen, and staff then record the CIP number.
        $application->forceFill(['locked_at' => now()])->save();

        return $application->refresh();
    }

    public function test_the_internal_number_is_generated_on_creation_in_the_brief_s_format(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);

        $first = Applications::create($provider, $staff);
        $second = Applications::create($provider, $staff);

        $year = now()->format('y');

        $this->assertSame('GAL'.$year.'-00001', $first->internal_number);
        $this->assertSame('GAL'.$year.'-00002', $second->internal_number);
        // Nothing from the Unit yet, so the internal number is what shows.
        $this->assertSame($first->internal_number, $first->displayNumber());
    }

    public function test_each_provider_has_its_own_sequence(): void
    {
        $staff = $this->staff();
        $galaxy = $this->provider($staff);
        $private = $this->provider($staff, 'PRI', 'Private Client');

        $year = now()->format('y');

        $this->assertSame('GAL'.$year.'-00001', Applications::create($galaxy, $staff)->internal_number);
        $this->assertSame('PRI'.$year.'-00001', Applications::create($private, $staff)->internal_number);
        $this->assertSame('GAL'.$year.'-00002', Applications::create($galaxy, $staff)->internal_number);
    }

    public function test_recording_a_submission_switches_the_displayed_number(): void
    {
        $staff = $this->staff();
        $application = $this->ready($staff, $this->provider($staff));
        $internal = $application->internal_number;

        $application = Submission::record($application, $staff, '10T1G12661P', Carbon::parse('2026-08-10'));

        $this->assertSame('10T1G12661P', $application->displayNumber(), 'Every surface renders this.');
        $this->assertSame($internal, $application->internal_number, 'Kept for audit and invoicing.');
        $this->assertSame('2026-08-10', $application->submitted_at->toDateString());
        $this->assertSame(Status::PENDING_REVIEW, $application->status);
    }

    public function test_the_switch_reaches_the_payload_every_screen_reads(): void
    {
        $staff = $this->staff();
        $application = $this->ready($staff, $this->provider($staff));
        $internal = $application->internal_number;

        $before = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()->json('application');

        $this->assertSame($internal, $before['number']);
        $this->assertNull($before['cipNumber']);

        $after = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
                'submittedAt' => '2026-08-10',
            ])
            ->assertOk()->json('application');

        $this->assertSame('10T1G12661P', $after['number'], 'The one field every surface draws.');
        $this->assertSame('10T1G12661P', $after['cipNumber']);
        $this->assertSame($internal, $after['internalNumber'], 'Still there underneath.');
        $this->assertSame('pending_review', $after['status']);
    }

    public function test_an_application_can_be_found_by_either_number_or_by_name(): void
    {
        $staff = $this->staff();
        $application = $this->ready($staff, $this->provider($staff));
        $internal = $application->internal_number;
        $uid = $application->client->uid;

        $find = fn (string $term) => $this->actingAs($staff)
            ->getJson('/portal/clients/search?q='.urlencode($term))
            ->assertOk()->json('ids');

        $this->assertContains($uid, $find($internal), 'Internal number.');
        $this->assertContains($uid, $find('Chen'), 'Applicant name.');

        Submission::record($application, $staff, '10T1G12661P');

        $this->assertContains($uid, $find('10T1G12661P'), 'CIP number.');
        $this->assertContains($uid, $find($internal), 'And the internal one still — invoices outlive the switch.');
    }

    public function test_a_number_search_is_anchored_so_it_answers_one_record(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $wanted = $this->ready($staff, $provider, 'Chen Wei');
        $other = $this->ready($staff, $provider, 'Omar Haddad');

        $ids = $this->actingAs($staff)
            ->getJson('/portal/clients/search?q='.urlencode($wanted->internal_number))
            ->assertOk()->json('ids');

        $this->assertContains($wanted->client->uid, $ids);
        $this->assertNotContains($other->client->uid, $ids, 'A sequence is not a substring search.');
    }

    public function test_the_same_cip_number_cannot_be_recorded_twice(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $first = $this->ready($staff, $provider, 'Chen Wei');
        $second = $this->ready($staff, $provider, 'Omar Haddad');

        Submission::record($first, $staff, '10T1G12661P');

        $this->expectException(ValidationException::class);
        // Case folded: two rows differing only in case are the same number to
        // everyone but the database.
        Submission::record($second, $staff, '10t1g12661p');
    }

    public function test_a_pasted_number_keeps_its_case_and_loses_its_whitespace(): void
    {
        $staff = $this->staff();
        $application = $this->ready($staff, $this->provider($staff));

        $application = Submission::record($application, $staff, "  10T1G12661P\u{00a0} ");

        $this->assertSame('10T1G12661P', $application->cip_number);
    }

    public function test_a_number_cannot_be_used_to_skip_the_lifecycle(): void
    {
        $staff = $this->staff();
        $application = Applications::create($this->provider($staff), $staff);

        // Straight from New Applications. §16 begins at Ready to Submit after
        // the provider has confirmed, and the engine owns that edge — recording
        // a number is not a way around it.
        $application->forceFill(['locked_at' => now()])->save();
        $this->expectException(\InvalidArgumentException::class);
        Submission::record($application, $staff, '10T1G12661P');
    }

    public function test_a_mistyped_number_is_corrected_without_moving_the_status(): void
    {
        $staff = $this->staff();
        $application = $this->ready($staff, $this->provider($staff));

        Submission::record($application, $staff, '10T1G12661X');
        $application = Submission::correct($application->refresh(), $staff, '10T1G12661P');

        $this->assertSame('10T1G12661P', $application->displayNumber());
        $this->assertSame(Status::PENDING_REVIEW, $application->status, 'A typo is not a lifecycle event.');

        $event = CipEvent::where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_NUMBER_ASSIGNED)
            ->latest('id')->first();

        $this->assertNotNull($event);
        $this->assertSame('10T1G12661X', $event->meta['previous'], 'What it was is on the record.');
    }

    public function test_the_number_is_written_to_the_audit_trail_with_the_internal_one(): void
    {
        $staff = $this->staff();
        $application = $this->ready($staff, $this->provider($staff));
        $internal = $application->internal_number;

        Submission::record($application, $staff, '10T1G12661P');

        $event = CipEvent::where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_NUMBER_ASSIGNED)
            ->first();

        $this->assertNotNull($event);
        $this->assertSame('10T1G12661P', $event->meta['cipNumber']);
        $this->assertSame($internal, $event->meta['internalNumber'], 'So an invoice can be reconciled later.');
    }
}
