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
use App\Support\Cip\Decision;
use App\Support\Cip\Engine;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Letters;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Section 23 — Granted and Denied letters, one pair per investment type.
 *
 * The filing subject stays section 22. These tests hold the body: administrators
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

    public function test_the_twenty_letters_are_there_on_the_first_day(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $payload = $this->actingAs($admin)
            ->getJson('/portal/cip/letters')
            ->assertOk()
            ->assertJsonPath('canEdit', true)
            ->json();

        $types = $payload['types'];

        $this->assertSame(array_values(InvestmentType::ALL), array_column($types, 'label'));
        $this->assertCount(5, $types);
        $this->assertSame(
            array_column(Letters::placeholders(), 'token'),
            array_column($payload['placeholders'], 'token'),
        );

        /*
         * A pair per lane, and the lanes named. Approved means a different
         * thing either side of the decision, so the screen has to say which
         * letter it is showing — two rows both labelled Granted with nothing
         * else to tell them apart would be a coin toss.
         */
        foreach ($types as $type) {
            $this->assertSame(
                [Phase::PRE_APPROVAL, Phase::POST_APPROVAL],
                array_column($type['phases'], 'value'),
            );

            foreach ($type['phases'] as $phase) {
                $this->assertSame(['Granted', 'Denied'], array_column($phase['letters'], 'decisionLabel'));
                $this->assertFalse($phase['letters'][0]['customized']);
                $this->assertSame($phase['value'], $phase['letters'][0]['phase']);
            }
        }

        $this->assertSame(20, CipDecisionTemplate::count());
    }

    /**
     * The two lanes send different letters.
     *
     * A grant recorded before the decision hands the reader the whole
     * three-stage post-approval process; one recorded on a file that has
     * already worked COR and NIC must not, or it reads as a mistake.
     */
    public function test_a_post_approval_decision_uses_the_post_approval_letter(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin, InvestmentType::REAL_ESTATE);

        $pre = Letters::for($application, Status::GRANTED);
        $this->assertSame(Phase::PRE_APPROVAL, $pre->phase);

        $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();
        $post = Letters::for($application->fresh(), Status::GRANTED);

        $this->assertSame(Phase::POST_APPROVAL, $post->phase);
        $this->assertNotSame($pre->id, $post->id);
        $this->assertNotSame($pre->body, $post->body);

        // The pre-approval grant is the one that hands the reader the three
        // stages; the post-approval one is written for somebody already past
        // them, so it must not carry the stage checklists.
        $this->assertStringContainsString('STAGE 1', $pre->body);
        $this->assertStringNotContainsString('STAGE 1', $post->body);
    }

    /**
     * Each lane decides with its own pair of statuses.
     *
     * The two lanes are two processes, so the post-approval one records
     * POST_APPROVED / POST_DENIED from where its work ends rather than
     * borrowing GRANTED / DENIED, which are only reachable from Background
     * check or Delayed. Sharing one pair is what put a post-approval file in
     * front of the pre-approval rule and refused it.
     */
    public function test_a_post_approval_file_records_the_lane_own_outcome(): void
    {
        Mail::fake();
        Storage::fake('local');

        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin, InvestmentType::REAL_ESTATE);
        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'status' => Status::POST_APPROVAL,
        ])->save();

        $decided = Decision::record(
            $application->fresh(),
            $admin,
            Status::GRANTED,
            null,
            '',
            UploadedFile::fake()->create('letter.pdf', 40, 'application/pdf'),
        );

        $this->assertSame(Status::POST_APPROVED, $decided->status);
        $this->assertSame('Approved', Status::label($decided->status));
        $this->assertSame(Phase::POST_APPROVAL, $decided->phase);

        // And it uses the lane's own letter.
        $this->assertSame(
            Phase::POST_APPROVAL,
            Letters::for($decided->fresh(), Status::GRANTED)->phase,
        );
    }

    /**
     * The decision gates the lane rather than closing it.
     *
     * Approved is what lets a file go on to collect COR, NIC and passport
     * paper; the stages are not reachable until it is recorded.
     */
    public function test_the_stages_open_only_after_the_decision(): void
    {
        Mail::fake();
        Storage::fake('local');

        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->inBackgroundCheck($admin, InvestmentType::REAL_ESTATE);
        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'status' => Status::POST_APPROVAL,
        ])->save();

        $this->assertNotContains(
            Status::APPLY_FOR_COR,
            Engine::availableTransitions($application->fresh(), $admin),
            'The COR stage waits on the decision.',
        );

        $decided = Decision::record(
            $application->fresh(),
            $admin,
            Status::GRANTED,
            null,
            '',
            UploadedFile::fake()->create('letter.pdf', 40, 'application/pdf'),
        );

        $this->assertContains(
            Status::APPLY_FOR_COR,
            Engine::availableTransitions($decided->fresh(), $admin),
            'Once approved, the file collects its COR documents.',
        );
    }

    /** Rewriting one lane's letter leaves the other alone. */
    public function test_editing_a_post_approval_letter_does_not_touch_the_pre_approval_one(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $post = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('phase', Phase::POST_APPROVAL)
            ->where('decision', Status::GRANTED)
            ->first();
        $pre = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('phase', Phase::PRE_APPROVAL)
            ->where('decision', Status::GRANTED)
            ->first();
        $wasPre = $pre->body;

        $this->actingAs($admin)->patchJson('/portal/cip/letters/'.$post->uuid, [
            'title' => '{{number}} — post-approval granted',
            'body' => 'The post-approval application for {{applicant}} was approved.',
        ])->assertOk();

        $this->assertSame($wasPre, $pre->fresh()->body);
        $this->assertTrue(Letters::isCustomized($post->fresh()));
        $this->assertFalse(Letters::isCustomized($pre->fresh()));
    }

    public function test_only_an_administrator_may_change_the_letters(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $this->actingAs($officer)->getJson('/portal/cip/letters')->assertOk()->assertJsonPath('canEdit', false);

        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('phase', Phase::PRE_APPROVAL)
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
            ->where('phase', Phase::PRE_APPROVAL)
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
        $this->assertSame(Letters::defaults()[InvestmentType::REAL_ESTATE][Phase::PRE_APPROVAL][Status::GRANTED]['body'], $restored['body']);
    }

    public function test_a_real_estate_grant_sends_the_real_estate_letter(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('phase', Phase::PRE_APPROVAL)
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
                && $mail->payload['lead'] === 'Citizenship granted to CHEN WEI on the Real Estate Project route. Family F1.';
        });
    }

    public function test_a_rich_editor_letter_keeps_its_lead_and_sanitized_body(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('phase', Phase::PRE_APPROVAL)
            ->where('decision', Status::GRANTED)
            ->first();

        $this->actingAs($admin)->patchJson('/portal/cip/letters/'.$letter->uuid, [
            'title' => '{{number}} was granted',
            'body' => '<p>Congratulations to {{applicant}} on being granted citizenship.</p>'
                .'<p><strong>STAGE 1</strong> requires the <font size="5">COR</font>.'
                .'<script>alert(1)</script></p>',
        ])->assertOk();

        $application = $this->inBackgroundCheck($admin, InvestmentType::REAL_ESTATE);

        $this->postCipDecision($admin, $application->uuid, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-08-18',
        ])->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            $body = (string) $mail->payload['bodyHtml'];

            // The first block is the centred lead, as plain text.
            return $mail->payload['lead'] === 'Congratulations to CHEN WEI on being granted citizenship.'
                && str_contains($body, '<strong>STAGE 1</strong>')
                && str_contains($body, '<font size="5">COR</font>')
                && ! str_contains($body, '<script')
                && ! str_contains($body, 'Congratulations');
        });
    }

    public function test_a_bonds_grant_does_not_use_the_real_estate_letter(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::REAL_ESTATE)
            ->where('phase', Phase::PRE_APPROVAL)
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
                && str_contains($mail->payload['lead'], '10T1G12661P – CHEN WEI')
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
                && str_contains($mail->payload['lead'], '10T1G12661P – CHEN WEI')
                && str_contains($mail->payload['lead'], 'granted citizenship of Saint Lucia')
                && str_contains($body, 'Escrow Documents')
                && str_contains($body, 'Sales &amp; Purchase Agreement')
                && str_contains($body, 'STAGE 1')
                && str_contains($body, 'font-weight:700')
                && $mail->payload['greeting'] === 'Dear Ada Admin,';
        });
    }

    public function test_an_other_route_fills_the_named_investment_and_the_decision_date(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::OTHER)
            ->where('phase', Phase::PRE_APPROVAL)
            ->where('decision', Status::GRANTED)
            ->first();

        $this->actingAs($admin)->patchJson('/portal/cip/letters/'.$letter->uuid, [
            'title' => '{{number}} — {{investmentType}} granted',
            'body' => '{{applicant}} was granted on {{decisionDate}} under {{investmentType}}.',
        ])->assertOk();

        $application = $this->inBackgroundCheck($admin, InvestmentType::OTHER);
        $application->forceFill(['investment_type_other' => 'Hotel licence'])->save();

        $this->postCipDecision($admin, $application->uuid, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-08-18',
        ])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return $mail->payload['title'] === '10T1G12661P — Hotel licence granted'
                && $mail->payload['lead'] === 'CHEN WEI was granted on 18.08.2026 under Hotel licence.';
        });
    }

    public function test_an_unknown_investment_type_uses_the_other_letter(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        $letter = CipDecisionTemplate::query()
            ->where('investment_type', InvestmentType::OTHER)
            ->where('phase', Phase::PRE_APPROVAL)
            ->where('decision', Status::GRANTED)
            ->first();

        $this->actingAs($admin)->patchJson('/portal/cip/letters/'.$letter->uuid, [
            'title' => 'OTHER CATCH-ALL',
            'body' => 'This is the Other granted letter.',
        ])->assertOk();

        $application = $this->inBackgroundCheck($admin, InvestmentType::NATIONAL_ACTION_BONDS);
        $application->forceFill(['investment_type' => 'legacy_mystery'])->save();

        $this->postCipDecision($admin, $application->uuid, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-08-18',
        ])
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return $mail->payload['title'] === 'OTHER CATCH-ALL'
                && $mail->payload['lead'] === 'This is the Other granted letter.';
        });
    }
}
