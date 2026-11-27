<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * An administrator may hand a file to another service provider at any
 * stage: whatever its status, its phase, or whether its papers are frozen.
 */
class CipProviderTransferAnyStageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function provider(string $code, string $name): CipProvider
    {
        $company = Company::create(['uid' => strtolower($code).'-firm', 'name' => $name]);

        return CipProvider::create([
            'name' => $name,
            'code' => $code,
            'company_id' => $company->id,
            'active' => true,
        ]);
    }

    /** @return array<string, array{0: string}> */
    public static function statuses(): array
    {
        return collect(Status::ALL)
            ->mapWithKeys(fn (string $s) => [$s => [$s]])
            ->all();
    }

    #[DataProvider('statuses')]
    public function test_an_administrator_changes_the_provider_at_any_status(string $status): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $from = $this->provider('GAL', 'Galaxy');
        $to = $this->provider('IGA', 'iGraphix');
        $client = Client::create(['uid' => 'chen-wei', 'name' => 'Chen Wei', 'data' => []]);
        $application = Applications::create($from, $admin, ['client_id' => $client->id]);

        $postApproval = in_array($status, [
            Status::POST_APPROVAL, Status::APPLY_FOR_COR, Status::PENDING_COR, Status::COR_RECEIVED,
            Status::APPLY_FOR_NIC, Status::PENDING_NIC, Status::NIC_RECEIVED, Status::APPLY_FOR_PASSPORT,
            Status::PENDING_PASSPORT, Status::PASSPORT_RECEIVED, Status::PASSPORT_DELIVERED,
            Status::READY_FOR_DELIVERY, Status::CLOSED, Status::POST_APPROVED, Status::POST_DENIED,
        ], true);

        $application->forceFill([
            'status' => $status,
            'phase' => $postApproval ? Phase::POST_APPROVAL : Phase::PRE_APPROVAL,
            'locked_at' => now(),
            'cor_locked_at' => $postApproval ? now() : null,
            'cip_number' => 'CIP-'.strtoupper(substr($status, 0, 6)),
        ])->save();

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $to->uuid,
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJsonPath('application.providerId', $to->uuid);

        $this->assertSame($to->id, $application->fresh()->provider_id);
    }
}
