<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\ActivityLog;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipPersonChangeRequest;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\Contacts;
use App\Support\Cip\Distribution;
use App\Support\Cip\Engine;
use App\Support\Cip\InvestmentCopies;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\NotificationEmail;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * One notification email for a service provider.
 *
 * Everyone on a firm's Access list is emailed about its work. A firm may ask
 * for the email to go to one of them: the others keep their access and the
 * bell in the portal, and are not emailed. Nobody chosen is everyone, which
 * is how every firm stood before this and what the first test holds still.
 *
 * What a person needs in order to get in or to act stays theirs whatever
 * the firm chose: security mail, and a change to their own access.
 */
class CompanyNotificationEmailTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Distribution::flush();
        InvestmentCopies::flush();

        // The file share at the end writes a folder; keep it off the real disk.
        $this->vaultRoot = sys_get_temp_dir().'/tma-vault-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
    }

    protected function tearDown(): void
    {
        @rmdir($this->vaultRoot);
        parent::tearDown();
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

    private function member(Company $company, string $email, string $name, bool $account = true, string $type = Role::CLIENT): CompanyMember
    {
        $user = $account ? $this->user($type, $email, $name) : null;

        return CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $user?->id,
            'name' => $name, 'email' => $email, 'role' => 'member',
            'status' => $user ? CompanyMember::STATUS_ACTIVE : CompanyMember::STATUS_INVITED,
        ]);
    }

    /**
     * A firm with every kind of mailbox a notice reaches: two people with
     * accounts, the registry's contact address and the company's own.
     *
     * @return array{0: Company, 1: CipProvider, 2: CompanyMember, 3: CompanyMember}
     */
    private function firm(string $code, User $admin): array
    {
        $slug = strtolower($code);
        $company = Company::create([
            'uid' => $slug, 'name' => $code.' Firm', 'created_by' => $admin->id,
            'email' => 'office@'.$slug.'.example',
        ]);
        $provider = CipProvider::create([
            'name' => $code.' Firm', 'code' => $code, 'company_id' => $company->id,
            'contact_email' => 'notices@'.$slug.'.example', 'contact_name' => $code.' Notices',
        ]);

        return [
            $company, $provider,
            $this->member($company, 'gil@'.$slug.'.example', 'Gil '.$code),
            $this->member($company, 'hana@'.$slug.'.example', 'Hana '.$code),
        ];
    }

    /** An application the firm filed, with its applicant and a client row. */
    private function filed(CipProvider $provider, User $admin, array $attributes = []): CipApplication
    {
        $client = Client::create([
            'uid' => 'chen-wei-'.strtolower($provider->code), 'name' => 'Chen Wei',
            'email' => 'chen@example.com', 'created_by' => $admin->id, 'data' => [],
        ]);
        $application = Applications::create($provider, $admin, array_merge(['client_id' => $client->id], $attributes));
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application->fresh();
    }

    private function assertMailed(string ...$mailboxes): void
    {
        foreach ($mailboxes as $mailbox) {
            Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo($mailbox));
        }
    }

    private function assertNotMailed(string ...$mailboxes): void
    {
        foreach ($mailboxes as $mailbox) {
            Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo($mailbox));
            $this->assertDatabaseMissing('email_deliveries', ['recipient' => $mailbox]);
        }
    }

    private function assertBell(CompanyMember $member, CipApplication $application): void
    {
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $member->user_id,
            'subject_id' => $application->id,
            'subject_type' => CipApplication::class,
        ]);
    }

    /* ── CIP notices ─────────────────────────────────────── */

    public function test_with_nobody_chosen_every_mailbox_at_the_firm_is_emailed(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [, $provider] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);

        Assignments::assign($application, $rita, $ada);

        $this->assertMailed(
            'ada@example.com', 'rita@example.com',
            'gil@gal.example', 'hana@gal.example', 'notices@gal.example', 'office@gal.example',
        );
        Mail::assertQueuedCount(6);

        foreach (Contacts::providerContacts($provider) as $row) {
            $this->assertArrayNotHasKey('mail', $row, 'an untouched firm carries no flag at all');
        }
    }

    public function test_a_chosen_member_is_the_only_mailbox_at_the_firm_that_is_emailed(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [$company, $provider, $gil, $hana] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);

        NotificationEmail::choose($company, $gil, $ada);
        Assignments::assign($application, $rita, $ada);

        // The firm's own staff are not the firm's choice to make.
        $this->assertMailed('ada@example.com', 'rita@example.com', 'gil@gal.example');
        $this->assertNotMailed('hana@gal.example', 'notices@gal.example', 'office@gal.example');
        Mail::assertQueuedCount(3);

        // The others still hear of it in the portal.
        $this->assertBell($hana, $application);
        $this->assertBell($gil, $application);
    }

    public function test_everyone_at_the_firm_still_gets_the_live_refresh(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, $provider, $gil, $hana] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);

        $before = Contacts::providerUserIds($application);
        NotificationEmail::choose($company, $gil, $ada);
        $after = Contacts::providerUserIds($application->fresh());

        sort($before);
        sort($after);
        $this->assertSame([$gil->user_id, $hana->user_id], $before);
        $this->assertSame($before, $after);
    }

    public function test_an_invited_member_who_never_signs_in_may_be_the_one(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [$company, $provider, $gil, $hana] = $this->firm('GAL', $ada);
        $shared = $this->member($company, 'cip@gal.example', 'Galaxy CIP desk', account: false);
        $application = $this->filed($provider, $ada);

        NotificationEmail::choose($company, $shared, $ada);
        Assignments::assign($application, $rita, $ada);

        $this->assertMailed('ada@example.com', 'rita@example.com', 'cip@gal.example');
        $this->assertNotMailed('gil@gal.example', 'hana@gal.example', 'notices@gal.example', 'office@gal.example');
        Mail::assertQueuedCount(3);
        $this->assertBell($gil, $application);
        $this->assertBell($hana, $application);
    }

    public function test_when_the_chosen_member_leaves_everyone_is_emailed_again(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [$company, $provider, $gil] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);

        NotificationEmail::choose($company, $gil, $ada);
        CompanyMembers::remove($company, $gil->fresh(), $ada);
        Mail::fake();

        // Leaving ends the choice, and says so in the trail.
        $this->assertNull($company->fresh()->notification_member_id);
        $this->assertNull(NotificationEmail::memberFor($company->fresh()));
        $this->assertSame(2, ActivityLog::where('activity_type', 'company.notification_email_changed')->count());

        Assignments::assign($application, $rita, $ada);

        // Never silence: a choice that no longer stands is no choice.
        $this->assertMailed('hana@gal.example', 'notices@gal.example', 'office@gal.example');
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@gal.example'));
    }

    public function test_a_member_who_comes_back_is_not_the_only_mailbox_again(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [$company, $provider, $gil] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);

        NotificationEmail::choose($company, $gil, $ada);
        CompanyMembers::remove($company, $gil->fresh(), $ada);
        $back = CompanyMembers::add($company->fresh(), [
            'email' => 'gil@gal.example', 'name' => 'Gil GAL', 'role' => 'member',
        ], $ada, notify: false);
        Mail::fake();

        $this->assertSame($gil->id, $back->id, 'the same row is revived');
        $this->assertNull(NotificationEmail::memberFor($company->fresh()));

        Assignments::assign($application, $rita, $ada);

        $this->assertMailed('gil@gal.example', 'hana@gal.example', 'notices@gal.example', 'office@gal.example');
    }

    public function test_a_membership_ended_behind_the_models_back_still_ends_the_choice_on_return(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        // The way an account sent to the Recycle Bin loses its memberships:
        // one statement over every row, with no model event to hear it.
        CompanyMember::whereKey($gil->id)->update(['status' => CompanyMember::STATUS_REMOVED]);
        $this->assertNull(NotificationEmail::memberFor($company->fresh()), 'gone is everyone, straight away');

        CompanyMembers::add($company->fresh(), [
            'email' => 'gil@gal.example', 'name' => 'Gil GAL', 'role' => 'member',
        ], $ada, notify: false);

        $this->assertNull($company->fresh()->notification_member_id);
        $this->assertNull(NotificationEmail::memberFor($company->fresh()));
    }

    public function test_the_listing_reads_the_choice_afresh_after_the_list_changes(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);
        CompanyMember::whereKey($gil->id)->update(['status' => CompanyMember::STATUS_REMOVED]);

        // Re-added through the door the Access card uses: the answer it
        // paints from must not still call him the notification email.
        $members = $this->actingAs($ada)->postJson('/portal/companies/'.$company->uid.'/members', [
            'email' => 'gil@gal.example', 'role' => 'member',
        ])->assertCreated()->json('members');

        $this->assertNotContains(true, array_column($members, 'notificationEmail'));
    }

    public function test_a_company_loaded_for_its_name_alone_still_knows_its_choice(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        $partial = Company::query()->select(['id', 'uid', 'name'])->find($company->id);

        $this->assertSame($gil->id, NotificationEmail::memberFor($partial)?->id);
    }

    public function test_a_staff_mailbox_that_is_also_on_the_firms_record_keeps_its_copy(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [$company, $provider, $gil] = $this->firm('GAL', $ada);
        // The officer's own address written on the register as the contact.
        $provider->forceFill(['contact_email' => 'rita@example.com'])->save();
        $application = $this->filed($provider->fresh(), $ada);

        NotificationEmail::choose($company, $gil, $ada);
        Assignments::assign($application, $rita, $ada);

        // Quiet as the firm's contact, owed as the assigned officer: mailed.
        $this->assertMailed('ada@example.com', 'rita@example.com', 'gil@gal.example');
        $this->assertNotMailed('hana@gal.example', 'office@gal.example');
        Mail::assertQueuedCount(3);
    }

    public function test_a_firm_copied_on_its_own_file_is_still_one_mailbox(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, $galaxy, $gil] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        // On the register for the very investment it files.
        $this->actingAs($ada)->patchJson('/portal/cip/investment-copies', [
            'copies' => [InvestmentType::REAL_ESTATE => ['providerIds' => [$galaxy->uuid], 'emails' => []]],
        ])->assertOk();

        $application = $this->filed($galaxy, $ada, ['investment_type' => InvestmentType::REAL_ESTATE]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();
        Mail::fake();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        // Named twice, quiet both times: naming it twice does not wake it.
        $this->assertMailed('gil@gal.example', 'ada@example.com');
        $this->assertNotMailed('hana@gal.example', 'notices@gal.example', 'office@gal.example');
        Mail::assertQueuedCount(2);
    }

    public function test_a_client_who_is_their_own_provider_side_is_still_told(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        // A firm with nobody on its standing list: no people, no mailboxes.
        $company = Company::create(['uid' => 'solo', 'name' => 'Solo Firm', 'created_by' => $ada->id]);
        $provider = CipProvider::create(['name' => 'Solo Firm', 'code' => 'SOL', 'company_id' => $company->id]);
        $desk = $this->member($company, 'desk@solo.example', 'Solo desk', account: false);
        $application = $this->filed($provider, $ada);

        NotificationEmail::choose($company, $desk, $ada);
        Assignments::assign($application, $rita, $ada);

        // The firm's chosen mailbox, and the client as before the choice.
        $this->assertMailed('desk@solo.example', 'chen@example.com', 'ada@example.com', 'rita@example.com');
        Mail::assertQueuedCount(4);
    }

    public function test_the_card_is_told_the_address_the_notices_are_written_to(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        [$company, $provider] = $this->firm('GAL', $ada);
        // Added under the firm's accounts address, signs in with her own.
        $jane = $this->user(Role::CLIENT, 'jane@gal.example', 'Jane GAL');
        $row = CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $jane->id, 'name' => 'Jane GAL',
            'email' => 'accounts@gal.example', 'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $application = $this->filed($provider, $ada);

        $members = $this->actingAs($ada)
            ->putJson('/portal/companies/'.$company->uid.'/notification-email', ['member' => $row->uuid])
            ->assertOk()->json('members');
        $listed = collect($members)->firstWhere('id', $row->uuid);

        $this->assertSame('jane@gal.example', $listed['email']);
        $this->assertSame('accounts@gal.example', $listed['notificationAddress']);

        Assignments::assign($application, $rita, $ada);

        $this->assertMailed('accounts@gal.example');
        $this->assertNotMailed('jane@gal.example', 'gil@gal.example', 'hana@gal.example');
        // And she is not left out of her own mail for signing in elsewhere.
        $this->assertTrue(NotificationEmail::wanted($jane));
    }

    public function test_a_member_of_another_firm_is_never_read_as_this_firms_choice(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company] = $this->firm('GAL', $ada);
        [, , $stranger] = $this->firm('DEV', $ada);

        $company->forceFill(['notification_member_id' => $stranger->id])->saveQuietly();

        $this->assertNull(NotificationEmail::memberFor($company->fresh()));
    }

    public function test_a_message_to_the_provider_is_emailed_to_the_chosen_member_only(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, $provider, $gil, $hana] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);
        NotificationEmail::choose($company, $gil, $ada);

        $this->actingAs($ada)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Please send the original.',
                'lane' => 'provider',
            ])->assertCreated();

        $this->assertMailed('gil@gal.example');
        $this->assertNotMailed('hana@gal.example', 'notices@gal.example', 'office@gal.example');
        Mail::assertQueuedCount(1);

        foreach ([$gil, $hana] as $member) {
            $this->assertDatabaseHas('portal_notifications', [
                'user_id' => $member->user_id, 'type' => 'cip.message',
            ]);
        }
    }

    public function test_a_firm_copied_on_another_firms_file_keeps_its_own_choice(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [, $galaxy] = $this->firm('GAL', $ada);
        [$devCompany, $developer, $devGil] = $this->firm('DEV', $ada);
        NotificationEmail::choose($devCompany, $devGil, $ada);

        $this->actingAs($ada)->patchJson('/portal/cip/investment-copies', [
            'copies' => [
                InvestmentType::REAL_ESTATE => [
                    'providerIds' => [$developer->uuid],
                    // Typed in by hand, and also somebody the firm left out.
                    'emails' => ['hana@dev.example'],
                ],
            ],
        ])->assertOk();

        $application = $this->filed($galaxy, $ada, ['investment_type' => InvestmentType::REAL_ESTATE]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();
        Mail::fake();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        // The filing firm chose nobody: all four of its mailboxes.
        $this->assertMailed('gil@gal.example', 'hana@gal.example', 'notices@gal.example', 'office@gal.example');
        // The copied firm chose Gil; Hana is mailed because she was typed in.
        $this->assertMailed('gil@dev.example', 'hana@dev.example', 'ada@example.com');
        $this->assertNotMailed('notices@dev.example', 'office@dev.example');
        Mail::assertQueuedCount(7);
    }

    public function test_the_filing_firms_choice_does_not_quiet_a_firm_copied_on_its_file(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$galCompany, $galaxy, $gil] = $this->firm('GAL', $ada);
        [, $developer] = $this->firm('DEV', $ada);
        NotificationEmail::choose($galCompany, $gil, $ada);

        $this->actingAs($ada)->patchJson('/portal/cip/investment-copies', [
            'copies' => [InvestmentType::REAL_ESTATE => ['providerIds' => [$developer->uuid], 'emails' => []]],
        ])->assertOk();

        $application = $this->filed($galaxy, $ada, ['investment_type' => InvestmentType::REAL_ESTATE]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();
        Mail::fake();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        $this->assertMailed('gil@gal.example', 'ada@example.com');
        $this->assertNotMailed('hana@gal.example', 'notices@gal.example', 'office@gal.example');
        $this->assertMailed('gil@dev.example', 'hana@dev.example', 'notices@dev.example', 'office@dev.example');
        Mail::assertQueuedCount(6);
    }

    public function test_the_answer_to_a_change_request_reaches_a_left_out_member_on_the_bell(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, $provider, $gil, $hana] = $this->firm('GAL', $ada);
        $application = $this->filed($provider, $ada);
        $person = $application->people()->first();
        NotificationEmail::choose($company, $gil, $ada);

        $decide = function (CompanyMember $asker) use ($application, $person, $ada) {
            $request = CipPersonChangeRequest::create([
                'application_id' => $application->id, 'person_id' => $person->id,
                'requested_by' => $asker->user_id, 'changes' => ['first_name' => 'Chan'],
                'before' => ['first_name' => 'Chen'],
            ]);
            $request->forceFill([
                'status' => CipPersonChangeRequest::STATUS_APPROVED,
                'decided_by' => $ada->id, 'decided_at' => now(),
            ])->save();

            Notices::personChangeDecided($request->fresh(), $ada);
        };

        $decide($hana);
        $this->assertNotMailed('hana@gal.example');
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $hana->user_id, 'type' => 'cip.person-change',
        ]);

        $decide($gil);
        $this->assertMailed('gil@gal.example');
    }

    /* ── Choosing ────────────────────────────────────────── */

    public function test_an_administrator_chooses_and_clears_the_notification_email(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil, $hana] = $this->firm('GAL', $ada);
        $url = '/portal/companies/'.$company->uid.'/notification-email';

        // Nobody is flagged until somebody is chosen.
        $listed = $this->actingAs($ada)->getJson('/portal/companies/'.$company->uid.'/members')
            ->assertOk()->json('members');
        $this->assertSame([false, false], array_column($listed, 'notificationEmail'));

        $members = $this->actingAs($ada)->putJson($url, ['member' => $hana->uuid])
            ->assertOk()->json('members');
        $flags = array_column($members, 'notificationEmail', 'id');
        $this->assertTrue($flags[$hana->uuid]);
        $this->assertFalse($flags[$gil->uuid]);
        $this->assertSame($hana->id, $company->fresh()->notification_member_id);

        $log = ActivityLog::where('activity_type', 'company.notification_email_changed')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertStringContainsString('hana@gal.example', $log->description);

        $members = $this->actingAs($ada)->putJson($url, ['member' => null])
            ->assertOk()->json('members');
        $this->assertSame([false, false], array_column($members, 'notificationEmail'));
        $this->assertNull($company->fresh()->notification_member_id);
        $this->assertSame(2, ActivityLog::where('activity_type', 'company.notification_email_changed')->count());

        // Saying the same thing twice is not a change.
        $this->actingAs($ada)->putJson($url, ['member' => null])->assertOk();
        $this->assertSame(2, ActivityLog::where('activity_type', 'company.notification_email_changed')->count());
    }

    public function test_choosing_does_not_touch_the_company_record(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil] = $this->firm('GAL', $ada);
        $before = $this->actingAs($ada)->getJson('/portal/companies/'.$company->uid)->assertOk()->json('company');

        $this->actingAs($ada)->putJson('/portal/companies/'.$company->uid.'/notification-email', [
            'member' => $gil->uuid,
        ])->assertOk();

        $after = $this->actingAs($ada)->getJson('/portal/companies/'.$company->uid)->assertOk()->json('company');
        $this->assertSame($before, $after);
    }

    public function test_only_somebody_on_this_firms_list_can_be_chosen(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil] = $this->firm('GAL', $ada);
        [, , $stranger] = $this->firm('DEV', $ada);
        $url = '/portal/companies/'.$company->uid.'/notification-email';

        $this->actingAs($ada)->putJson($url, ['member' => $stranger->uuid])->assertStatus(422);
        // Not a uuid at all, and a well-formed one that is nobody's.
        $this->actingAs($ada)->putJson($url, ['member' => 'no-such-member'])->assertStatus(422);
        $this->actingAs($ada)->putJson($url, ['member' => (string) Str::uuid()])->assertStatus(422);
        // On the list, and nowhere to write to.
        $silent = CompanyMember::create([
            'company_id' => $company->id, 'name' => 'No Address', 'role' => 'member',
            'status' => CompanyMember::STATUS_INVITED,
        ]);
        $this->actingAs($ada)->putJson($url, ['member' => $silent->uuid])->assertStatus(422);
        // The key has to be sent: a body with nothing in it must not clear a choice.
        $this->actingAs($ada)->putJson($url, [])->assertStatus(422);

        CompanyMembers::remove($company, $gil->fresh(), $ada);
        $this->actingAs($ada)->putJson($url, ['member' => $gil->uuid])->assertStatus(422);

        $this->assertNull($company->fresh()->notification_member_id);
    }

    public function test_the_firms_own_admin_may_choose_and_nobody_else_at_a_firm_may(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil, $hana] = $this->firm('GAL', $ada);
        [$other] = $this->firm('DEV', $ada);
        $boss = $this->member($company, 'boss@gal.example', 'Bo Boss', type: Role::SERVICE_PROVIDER_ADMIN);
        $url = '/portal/companies/'.$company->uid.'/notification-email';

        // An ordinary contact, and an admin of a different firm.
        $this->actingAs($hana->user)->putJson($url, ['member' => $hana->uuid])->assertForbidden();
        $this->actingAs($boss->user)
            ->putJson('/portal/companies/'.$other->uid.'/notification-email', ['member' => null])
            ->assertForbidden();
        $this->assertNull($company->fresh()->notification_member_id);

        $this->actingAs($boss->user)->putJson($url, ['member' => $gil->uuid])->assertOk();
        $this->assertSame($gil->id, $company->fresh()->notification_member_id);
    }

    /* ── Every other notification email ──────────────────── */

    private function notify(User $recipient, User $actor, string $type): void
    {
        Notifier::send([
            'user' => $recipient, 'actor' => $actor, 'type' => $type,
            'title' => 'Something happened', 'message' => 'Details inside.',
            'action_url' => '/folders/all',
        ]);
    }

    public function test_a_left_out_member_gets_the_bell_and_no_email_for_other_notifications(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil, $hana] = $this->firm('GAL', $ada);

        // Nobody chosen: as it always was.
        $this->notify($hana->user, $ada, 'file.comment');
        $this->assertMailed('hana@gal.example');

        NotificationEmail::choose($company, $gil, $ada);
        Mail::fake();

        $this->notify($hana->user, $ada, 'file.shared');
        $this->notify($gil->user, $ada, 'file.shared');

        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('hana@gal.example'));
        $this->assertMailed('gil@gal.example');
        $this->assertDatabaseHas('portal_notifications', ['user_id' => $hana->user_id, 'type' => 'file.shared']);
    }

    public function test_security_mail_and_a_change_to_their_own_access_still_reach_them(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil, $hana] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        $this->notify($hana->user, $ada, 'security.password_changed');
        Mail::assertQueuedCount(1);

        $this->notify($hana->user, $ada, 'company.role_changed');
        Mail::assertQueuedCount(2);

        // Asked by name to approve a file: that request has no other email.
        $this->notify($hana->user, $ada, 'file.approval_requested');
        Mail::assertQueuedCount(3);
        $this->assertMailed('hana@gal.example');
    }

    public function test_an_invited_mailbox_that_is_also_somebodys_login_does_not_leave_them_out(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , , $hana] = $this->firm('GAL', $ada);
        // A second row for the address she signs in with, never taken up.
        $desk = $this->member($company, 'hana@gal.example', 'Galaxy desk', account: false);

        NotificationEmail::choose($company, $desk, $ada);

        $this->assertTrue(NotificationEmail::wanted($hana->user));
    }

    public function test_staff_and_people_at_no_firm_are_never_left_out(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $client = $this->user(Role::CLIENT, 'solo@example.com', 'Solo Client');
        [$company, , $gil] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        $this->notify($rita, $ada, 'file.shared');
        $this->notify($client, $ada, 'file.shared');

        $this->assertMailed('rita@example.com', 'solo@example.com');
        $this->assertTrue(NotificationEmail::wanted(null));
    }

    public function test_somebody_at_two_firms_is_emailed_unless_both_chose_somebody_else(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$galaxy, , $gil, $hana] = $this->firm('GAL', $ada);
        [$developer, , $devGil] = $this->firm('DEV', $ada);
        CompanyMember::create([
            'company_id' => $developer->id, 'user_id' => $hana->user_id,
            'name' => 'Hana GAL', 'email' => 'hana@gal.example', 'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        NotificationEmail::choose($galaxy, $gil, $ada);
        $this->assertTrue(NotificationEmail::wanted($hana->user), 'the other firm chose nobody');

        NotificationEmail::choose($developer, $devGil, $ada);
        $this->assertFalse(NotificationEmail::wanted($hana->user));

        $this->assertTrue(NotificationEmail::wanted($gil->user), 'the chosen one is always emailed');
    }

    public function test_an_unread_message_reminder_is_not_emailed_to_a_left_out_member(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil, $hana] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        $waiting = [];
        foreach ([$gil, $hana] as $member) {
            $conversation = Conversation::create([
                'type' => Conversation::TYPE_DIRECT, 'created_by' => $ada->id, 'last_message_at' => now(),
            ]);
            foreach ([$ada->id, $member->user_id] as $userId) {
                ConversationParticipant::create([
                    'conversation_id' => $conversation->id, 'user_id' => $userId,
                    'role' => ConversationParticipant::ROLE_MEMBER, 'joined_at' => now(),
                ]);
            }
            Message::create([
                'conversation_id' => $conversation->id, 'user_id' => $ada->id,
                'type' => Message::TYPE_TEXT, 'body' => 'Are you there?',
            ])->forceFill(['created_at' => now()->subHours(2)])->save();

            $waiting[$member->user_id] = $conversation->id;
        }

        $this->artisan('messaging:send-unread-reminders')->assertSuccessful();

        $this->assertMailed('gil@gal.example');
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('hana@gal.example'));

        // Stamped all the same, so the next run does not weigh her again.
        foreach ($waiting as $userId => $conversationId) {
            $this->assertSame(1, (int) ConversationParticipant::where('conversation_id', $conversationId)
                ->where('user_id', $userId)->value('reminder_tier'));
        }
    }

    public function test_a_file_shared_with_a_left_out_member_reaches_them_on_the_bell(): void
    {
        Mail::fake();
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        [$company, , $gil, $hana] = $this->firm('GAL', $ada);
        NotificationEmail::choose($company, $gil, $ada);

        $folder = $this->actingAs($ada)
            ->postJson('/portal/files/folders', ['name' => 'Shared work'])->json('id');

        foreach ([$hana, $gil] as $member) {
            $this->actingAs($ada)->postJson('/portal/files/shares', [
                'type' => 'folder', 'id' => $folder, 'mode' => 'invite',
                'email' => $member->email, 'role' => 'viewer',
            ])->assertSuccessful();
        }

        $this->assertMailed('gil@gal.example');
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('hana@gal.example'));
        $this->assertDatabaseHas('portal_notifications', ['user_id' => $hana->user_id, 'type' => 'folder.shared']);
    }
}
