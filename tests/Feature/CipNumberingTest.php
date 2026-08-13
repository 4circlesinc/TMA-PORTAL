<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Internal numbers: [Provider Code][YY]-[Sequence], minted at creation inside
 * the insert transaction, gapless per provider per year, and displayed only
 * until the government CIP number takes over.
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
        $this->assertSame('draft', $application->status);
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
