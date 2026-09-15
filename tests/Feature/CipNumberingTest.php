<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Numbering;
use App\Support\Cip\Phase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Internal numbers: minted at creation inside the insert transaction, gapless
 * per provider per year per lane.
 *
 * Family files: [Provider Code][YY]-[Sequence], GAL26-00001, displayed only
 * until the government CIP number takes over.
 * Add-On files: [Provider Code]-AO-[YY]-[Sequence], GAL-AO-26-00001, kept for
 * the life of the row on a sequence that does not share family slots.
 */
class CipNumberingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function creator(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::EMPLOYEE,
            'email_verified_at' => now(),
        ]);
    }

    public function test_numbers_are_sequential_per_provider_and_year(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $private = CipProvider::create(['name' => 'Private Clients', 'code' => 'PRI']);
        $yy = now()->format('y');

        $first = Applications::create($galaxy, $creator);
        $second = Applications::create($galaxy, $creator);
        $other = Applications::create($private, $creator);

        $this->assertSame("GAL{$yy}-00001", $first->internal_number);
        $this->assertSame("GAL{$yy}-00002", $second->internal_number);
        // Sequences are per provider — PRI starts at one, not three.
        $this->assertSame("PRI{$yy}-00001", $other->internal_number);
    }

    public function test_creation_writes_the_first_audit_row(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $application = Applications::create($galaxy, $creator);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => 'created',
            'actor_id' => $creator->id,
        ]);
        $this->assertSame('new', $application->status);
    }

    public function test_display_number_switches_when_the_cip_number_arrives(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);

        $this->assertSame($application->internal_number, $application->displayNumber());

        $application->forceFill(['cip_number' => '10T1G12661P'])->save();

        // Every surface renders displayNumber(), so this one change is the
        // whole switching rule.
        $this->assertSame('10T1G12661P', $application->displayNumber());
        // The internal number is retained for audit and invoicing.
        $this->assertNotNull($application->internal_number);
    }

    public function test_reserving_a_historical_number_keeps_the_sequence_ahead_of_it(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $yy = now()->format('y');

        DB::transaction(function () use ($galaxy, $yy) {
            Numbering::reserve($galaxy, "GAL{$yy}-00007");
        });

        $next = Applications::create($galaxy, $creator);
        $this->assertSame("GAL{$yy}-00008", $next->internal_number);
    }

    public function test_add_on_numbers_use_their_own_sequence_and_format(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $private = CipProvider::create(['name' => 'Private Clients', 'code' => 'PRI']);
        $yy = now()->format('y');

        $family = Applications::create($galaxy, $creator);
        $first = Applications::create($galaxy, $creator, ['phase' => Phase::ADD_ON]);
        $second = Applications::create($galaxy, $creator, ['phase' => Phase::ADD_ON]);
        $other = Applications::create($private, $creator, ['phase' => Phase::ADD_ON]);
        $nextFamily = Applications::create($galaxy, $creator);

        $this->assertSame("GAL{$yy}-00001", $family->internal_number);
        $this->assertSame("GAL-AO-{$yy}-00001", $first->internal_number);
        $this->assertSame("GAL-AO-{$yy}-00002", $second->internal_number);
        $this->assertSame("PRI-AO-{$yy}-00001", $other->internal_number);
        $this->assertSame("GAL{$yy}-00002", $nextFamily->internal_number);

        $this->assertSame($first->internal_number, $first->displayNumber());
        $first->forceFill(['cip_number' => '10T1GSHOULDNOT'])->save();
        $this->assertSame("GAL-AO-{$yy}-00001", $first->fresh()->displayNumber());
    }

    public function test_reserving_an_add_on_number_does_not_advance_the_family_sequence(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $yy = now()->format('y');

        DB::transaction(function () use ($galaxy, $yy) {
            Numbering::reserve($galaxy, "GAL-AO-{$yy}-00007");
        });

        $family = Applications::create($galaxy, $creator);
        $addon = Applications::create($galaxy, $creator, ['phase' => Phase::ADD_ON]);

        $this->assertSame("GAL{$yy}-00001", $family->internal_number);
        $this->assertSame("GAL-AO-{$yy}-00008", $addon->internal_number);
    }

    public function test_family_size_counts_every_person(): void
    {
        $creator = $this->creator();
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);

        $application->people()->create(['role' => 'main_applicant', 'first_name' => 'John', 'last_name' => 'Smith']);
        $application->people()->create(['role' => 'sponsor', 'first_name' => 'Jane', 'last_name' => 'Smith']);
        $application->people()->createMany([
            ['role' => 'dependent', 'relationship' => 'qualified_dependent', 'first_name' => 'A', 'last_name' => 'Smith'],
            ['role' => 'dependent', 'relationship' => 'qualified_dependent', 'first_name' => 'B', 'last_name' => 'Smith'],
            ['role' => 'dependent', 'relationship' => 'qualified_dependent', 'first_name' => 'C', 'last_name' => 'Smith'],
            ['role' => 'dependent', 'relationship' => 'spouse', 'first_name' => 'D', 'last_name' => 'Smith'],
        ]);

        // 1 main + 1 sponsor + 4 dependents = F6, the brief's worked example.
        $this->assertSame(6, $application->fresh()->familySize());
        $this->assertSame('F6', $application->fresh()->familyLabel());
    }
}
