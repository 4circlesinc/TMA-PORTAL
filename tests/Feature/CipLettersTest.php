<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipDecisionTemplate;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Letters;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §23 — Granted and Denied letters, one pair per investment type.
 *
 * The filing subject stays §22. These tests hold the body: administrators
 * rewrite it, placeholders fill from the file, and a Real Estate grant does
 * not send the Bonds letter.
 */
class CipLettersTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email = 'ada@example.com', string $name = 'Ada Admin'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function inBackgroundCheck(User $staff, string $investmentType = InvestmentType::REAL_ESTATE): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        $application->forceFill([
            'status' => Status::BACKGROUND_CHECK,
            'cip_number' => '10T1G12661P',
            'investment_type' => $investmentType,
            'submitted_at' => '2026-02-01',
            'accepted_at' => '2026-02-18',
            'locked_at' => now(),
        ])->save();

        return $application->refresh();
    }

    public function test_the_ten_letters_are_there_on_the_first_day(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $types = $this->actingAs($admin)
            ->getJson('/portal/cip/letters')
            ->assertOk()
            ->assertJsonPath('canEdit', true)
            ->json('types');

        $this->assertSame(array_values(InvestmentType::ALL), array_column($types, 'label'));
        $this->assertCount(5, $types);

        foreach ($types as $type) {
            $this->assertSame(['Granted', 'Denied'], array_column($type['letters'], 'decisionLabel'));
            $this->assertFalse($type['letters'][0]['customized']);
        }

        $this->assertSame(10, CipDecisionTemplate::count());
    }

    public function test_only_an_administrator_may_change_the_letters(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $this->actingAs($officer)->getJson('/portal/cip/letters')->assertOk()->assertJsonPath('canEdit', false);

        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('decision', Status::GRANTED)
            ->first();

        $this->actingAs($officer)
            ->patchJson('/portal/cip/letters/'.$letter->uuid, [
                'title' => '{{number}} was granted',
                'body' => 'Rewritten.',
            ])
            ->assertForbidden();
    }

    public function test_an_administrator_rewrites_a_letter_and_can_put_the_default_back(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('decision', Status::GRANTED)
            ->first();

        $updated = $this->actingAs($admin)
            ->patchJson('/portal/cip/letters/'.$letter->uuid, [
                'title' => '{{number}} — citizenship granted',
                'body' => 'Real estate grant for {{applicant}} via {{investmentType}}.',
            ])
            ->assertOk()
            ->json();

        $this->assertTrue($updated['customized']);
        $this->assertSame('{{number}} — citizenship granted', $updated['title']);

        $restored = $this->actingAs($admin)
            ->postJson('/portal/cip/letters/'.$letter->uuid.'/restore')
            ->assertOk()
            ->json();

        $this->assertFalse($restored['customized']);
        $this->assertSame(Letters::defaults()[InvestmentType::REAL_ESTATE][Status::GRANTED]['body'], $restored['body']);
    }

    public function test_a_real_estate_grant_sends_the_real_estate_letter(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('decision', Status::GRANTED)
            ->first();

        $this->actingAs($admin)->patchJson('/portal/cip/letters/'.$letter->uuid, [
            'title' => '{{number}} — real estate granted',
            'body' => 'Citizenship granted to {{applicant}} on the {{investmentType}} route. Family {{familySize}}.',
        ])->assertOk();

        $application = $this->inBackgroundCheck($admin, InvestmentType::REAL_ESTATE);

        $this->postCipDecision($admin, $application->uuid, [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk();

        $expected = 'AA - GRANTED - 10T1G12661P - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->payload['title'] === '10T1G12661P — real estate granted'
                && $mail->payload['lead'] === 'Citizenship granted to Chen Wei on the Real Estate Project route. Family F1.';
        });
    }

    public function test_a_bonds_grant_does_not_use_the_real_estate_letter(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('decision', Status::GRANTED)
            ->first();

        $this->actingAs($admin)->patchJson('/portal/cip/letters/'.$letter->uuid, [
            'title' => 'REAL ESTATE ONLY',
            'body' => 'This must not go to a bonds file.',
        ])->assertOk();

        $application = $this->inBackgroundCheck($admin, InvestmentType::NATIONAL_ACTION_BONDS);

        $this->postCipDecision($admin, $application->uuid, [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            $body = $mail->payload['bodyHtml'] ?? '';

            return str_contains($mail->payload['lead'], 'congratulations')
                && $mail->payload['title'] !== 'REAL ESTATE ONLY'
                && ! str_contains($mail->payload['lead'], 'This must not go to a bonds file.')
                && ! str_contains($body, 'Escrow Documents')
                && str_contains($body, 'POST-APPROVAL PROCESS');
        });
    }

    public function test_a_denial_uses_the_denied_letter_for_that_route(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin, InvestmentType::ENTERPRISE_PROJECT);

        $this->postCipDecision($admin, $application->uuid, [
                'decision' => Status::DENIED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            $body = $mail->payload['bodyHtml'] ?? '';

            return str_starts_with($mail->subjectLine, 'AA - DENIED -')
                && str_contains($mail->payload['lead'], '10T1G12661P – Chen Wei')
                && str_contains($mail->payload['lead'], 'denied')
                && str_contains($body, 'Section 37(2)(b)')
                && str_contains($body, 'sixty (60) days')
                && $mail->payload['greeting'] === 'Dear Ada Admin,';
        });
    }

    public function test_the_real_estate_grant_is_the_official_letter_with_escrow(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin, InvestmentType::REAL_ESTATE);

        $this->postCipDecision($admin, $application->uuid, [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            $body = $mail->payload['bodyHtml'] ?? '';

            return $mail->payload['title'] === '10T1G12661P was granted'
                && str_contains($mail->payload['lead'], '10T1G12661P – Chen Wei')
                && str_contains($mail->payload['lead'], 'granted citizenship of Saint Lucia')
                && str_contains($body, 'Escrow Documents')
                && str_contains($body, 'Sales &amp; Purchase Agreement')
                && str_contains($body, 'STAGE 1')
                && str_contains($body, 'font-weight:700')
                && $mail->payload['greeting'] === 'Dear Ada Admin,';
        });
    }
}
