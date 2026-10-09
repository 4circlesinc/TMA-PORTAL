<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\InvestmentCopies;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Settings › CIP Console › Investment Copies.
 *
 * A Real Estate developer or an Enterprise promoter hears every notice on
 * an application that funds them, whichever service provider filed it.
 */
class CipInvestmentCopiesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        InvestmentCopies::flush();
    }

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    /** @return array{0: CipProvider, 1: User} */
    private function firm(string $code, string $contactEmail, User $admin): array
    {
        $company = Company::create(['uid' => strtolower($code), 'name' => $code.' Firm', 'created_by' => $admin->id]);
        $provider = CipProvider::create([
            'name' => $code.' Firm', 'code' => $code, 'company_id' => $company->id,
            'contact_email' => 'notices@'.strtolower($code).'.example',
        ]);
        $contact = $this->user(Role::CLIENT, $contactEmail, $code.' Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => $contact->name, 'email' => $contact->email,
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $admin->id,
        ]);

        return [$provider, $contact];
    }

    public function test_only_an_administrator_may_change_the_lists(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com');

        $this->actingAs($officer)->getJson('/portal/cip/investment-copies')
            ->assertOk()
            ->assertJsonPath('canEdit', false);

        $this->actingAs($officer)->patchJson('/portal/cip/investment-copies', ['copies' => []])
            ->assertForbidden();
    }

    public function test_the_copied_firm_hears_every_notice_whichever_firm_filed(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$galaxy, $gil] = $this->firm('GAL', 'gil@galaxy.example', $admin);
        [$developer, $dev] = $this->firm('DEV', 'dev@developer.example', $admin);

        $saved = $this->actingAs($admin)->patchJson('/portal/cip/investment-copies', [
            'copies' => [
                InvestmentType::REAL_ESTATE => [
                    'providerIds' => [$developer->uuid],
                    'emails' => ['sales@developer.example', 'not an email'],
                ],
            ],
        ])->assertOk()->json('copies');

        $this->assertSame([$developer->uuid], $saved[InvestmentType::REAL_ESTATE]['providerIds']);
        $this->assertSame(['sales@developer.example'], $saved[InvestmentType::REAL_ESTATE]['emails']);
        $this->assertSame([], $saved[InvestmentType::ENTERPRISE_PROJECT]['providerIds']);

        // Filed by Galaxy, funds the developer's project.
        $application = Applications::create($galaxy, $admin, ['investment_type' => InvestmentType::REAL_ESTATE]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        foreach ([
            'gil@galaxy.example', 'notices@gal.example',
            'dev@developer.example', 'notices@dev.example', 'sales@developer.example',
            'ada@example.com',
        ] as $mailbox) {
            Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo($mailbox));
        }
        Mail::assertQueuedCount(6);
    }

    public function test_another_investment_type_copies_nobody_extra(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$galaxy] = $this->firm('GAL', 'gil@galaxy.example', $admin);
        [$developer] = $this->firm('DEV', 'dev@developer.example', $admin);

        InvestmentCopies::put([
            InvestmentType::REAL_ESTATE => ['providerIds' => [$developer->uuid], 'emails' => []],
        ], $admin->id);

        $application = Applications::create($galaxy, $admin, ['investment_type' => InvestmentType::NATIONAL_ECONOMIC_FUND]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('dev@developer.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
    }
}
