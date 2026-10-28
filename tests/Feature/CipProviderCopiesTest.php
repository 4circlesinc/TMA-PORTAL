<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Copies;
use App\Support\Cip\Distribution;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settings › Service Provider Emails: one switch per kind of CIP notice a
 * staff member is copied on.
 *
 * An untouched switch is on for the employees and off for administrators,
 * who are copied on every application. A switch somebody flipped beats the
 * old single switch, and that beats the account's default. The provider
 * side is the addressee, so nothing here silences it, and the bell rings
 * whatever the email does.
 */
class CipProviderCopiesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Distribution::flush();
        $this->travelTo('2026-10-14 12:00:00');
    }

    private function user(string $type, string $email, string $name, ?array $preferences = null): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type, 'preferences' => $preferences,
        ])->save();

        return $user;
    }

    /** A Galaxy file with one applicant, Gil on the provider side. */
    private function file(User $by, User $contact): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $by->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => $contact->name, 'email' => $contact->email,
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $by->id,
        ]);

        $application = Applications::create($provider, $by);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application->fresh();
    }

    public function test_an_untouched_switch_is_on_for_employees_and_off_for_administrators(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $legacyOfficer = $this->user('Reviewing Officer', 'rob@example.com', 'Rob Officer');
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $client = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        $this->assertSame(Copies::KINDS, array_keys(Copies::forUser($officer)));
        $this->assertNotContains(false, Copies::forUser($officer));
        $this->assertNotContains(false, Copies::forUser($legacyOfficer));
        $this->assertNotContains(true, Copies::forUser($admin));

        foreach (Copies::KINDS as $kind) {
            $this->assertTrue(Copies::wanted($officer, $kind), $kind);
            $this->assertFalse(Copies::wanted($admin, $kind), $kind);
            // The provider side and an account-less mailbox are written to, not copied.
            $this->assertTrue(Copies::wanted($client, $kind), $kind);
            $this->assertTrue(Copies::wanted(null, $kind), $kind);
        }
    }

    public function test_a_switch_of_its_own_beats_the_old_single_switch_and_the_role(): void
    {
        // Turned the old switch back on: every kind on, administrator or not.
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin', [
            'notifyProviderCopies' => true,
            'cipCopies' => [Status::DELAYED => false],
        ]);
        // Turned it off before the page existed: every kind off.
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer', [
            'notifyProviderCopies' => false,
            'cipCopies' => [Status::NEW => true],
        ]);

        $this->assertFalse(Copies::wanted($admin, Status::DELAYED));
        $this->assertTrue(Copies::wanted($admin, Status::GRANTED));
        $this->assertTrue(Copies::wanted($admin, Copies::COMMENT));

        $this->assertTrue(Copies::wanted($officer, Status::NEW));
        $this->assertFalse(Copies::wanted($officer, Status::GRANTED));
        $this->assertFalse(Copies::wanted($officer, Copies::COMMENT));

        // A kind the page does not list yet follows the old switch, then the role.
        $this->assertTrue(Copies::wanted($admin, 'a_kind_from_next_year'));
        $this->assertFalse(Copies::wanted($officer, 'a_kind_from_next_year'));
    }

    public function test_the_switches_round_trip_through_me_preferences(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');

        $all = $this->actingAs($officer)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('notifyProviderCopies', true)
            ->json('cipCopies');
        $this->assertSame(Copies::KINDS, array_keys($all));
        $this->assertNotContains(false, $all);

        // One switch off: only that choice is stored, and junk is dropped.
        $this->actingAs($officer)->putJson('/me/preferences', [
            'cipCopies' => [Status::DELAYED => false, 'not_a_kind' => true],
        ])
            ->assertOk()
            ->assertJsonPath('cipCopies.'.Status::DELAYED, false)
            ->assertJsonPath('cipCopies.'.Status::NEW, true)
            ->assertJsonPath('notifyProviderCopies', true);
        $this->assertSame([Status::DELAYED => false], $officer->fresh()->preferences['cipCopies']);

        // A null forgets the choice, and the switch follows the account again.
        $this->actingAs($officer)->putJson('/me/preferences', ['cipCopies' => [Status::DELAYED => null]])
            ->assertOk()
            ->assertJsonPath('cipCopies.'.Status::DELAYED, true);
        $this->assertArrayNotHasKey('cipCopies', $officer->fresh()->preferences);

        // The all switch says everything at once, and forgets single choices.
        $this->actingAs($officer)->putJson('/me/preferences', ['cipCopies' => [Status::CLOSED => true]])->assertOk();
        $off = $this->actingAs($officer)->putJson('/me/preferences', ['notifyProviderCopies' => false])
            ->assertOk()
            ->assertJsonPath('notifyProviderCopies', false)
            ->json('cipCopies');
        $this->assertNotContains(true, $off);
        $this->assertArrayNotHasKey('cipCopies', $officer->fresh()->preferences);

        // Sent together, the all switch lands first and the single one on top.
        $this->actingAs($officer)->putJson('/me/preferences', [
            'notifyProviderCopies' => true,
            'cipCopies' => [Status::CLOSED => false],
        ])
            ->assertOk()
            ->assertJsonPath('cipCopies.'.Status::CLOSED, false)
            ->assertJsonPath('cipCopies.'.Status::GRANTED, true);

        $this->actingAs($officer)->putJson('/me/preferences', ['cipCopies' => [Status::NEW => 'yes']])
            ->assertStatus(422);
    }

    public function test_an_administrator_reads_every_switch_off_until_they_turn_one_on(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');

        $all = $this->actingAs($admin)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('notifyProviderCopies', false)
            ->json('cipCopies');
        $this->assertNotContains(true, $all);
        // Reading the page stores nothing, so the default keeps following the role.
        $this->assertArrayNotHasKey('cipCopies', $admin->fresh()->preferences ?? []);
        $this->assertArrayNotHasKey('notifyProviderCopies', $admin->fresh()->preferences ?? []);

        $this->actingAs($admin)->putJson('/me/preferences', ['cipCopies' => [Status::GRANTED => true]])
            ->assertOk()
            ->assertJsonPath('cipCopies.'.Status::GRANTED, true)
            ->assertJsonPath('cipCopies.'.Status::DENIED, false)
            ->assertJsonPath('notifyProviderCopies', true);
    }

    public function test_each_notice_follows_each_persons_switch_for_its_kind(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $bea = $this->user(Role::ADMINISTRATOR, 'bea@example.com', 'Bea Admin', [
            'cipCopies' => [Status::REVIEW_APPLICATION => true],
        ]);
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer', [
            'cipCopies' => [Status::ASSESSMENT_FEEDBACK => false],
        ]);
        // A contact's own switches change nothing: they are the addressee.
        $gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact', [
            'notifyProviderCopies' => false,
        ]);

        $application = $this->file($ada, $gil);
        Assignments::assign($application, $rita, $ada);

        // Review Applications: Bea turned it on, Rita kept the default, Ada did not.
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('bea@example.com'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
        Mail::assertQueuedCount(3);
        $this->assertDatabaseMissing('email_deliveries', ['recipient' => 'ada@example.com']);

        // Assessment Feedback: Rita turned it off, Bea never turned it on.
        Mail::fake();
        Notices::announce($application->fresh(), Status::ASSESSMENT_FEEDBACK, $ada);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
        Mail::assertQueuedCount(1);

        // The bell is not a copy: everyone who did not make the move still
        // hears of it, Ada included.
        Notices::announce($application->fresh(), Status::PENDING_REVIEW, $rita);
        foreach ([$ada, $bea] as $staff) {
            $this->assertDatabaseHas('portal_notifications', [
                'user_id' => $staff->id,
                'subject_id' => $application->id,
                'subject_type' => CipApplication::class,
                'type' => 'cip.status',
            ]);
        }
    }

    public function test_a_document_comment_follows_the_comment_switch(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer', [
            'cipCopies' => [Copies::COMMENT => false],
        ]);
        $omar = $this->user(Role::REVIEWING_OFFICER, 'omar@example.com', 'Omar Officer');
        $gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        $application = $this->file($ada, $gil);
        Assignments::assign($application, $rita, $ada);
        Assignments::assign($application->fresh(), $omar, $ada, CipAccess::COMPLIANCE_OFFICER);
        Mail::fake();

        $slot = CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $application->id,
            'person_id' => $application->people()->first()->id,
            'type' => 'police_certificate',
            'label' => 'Police certificate',
            'required' => true,
        ]);

        Notices::documentComment($slot, $gil, 'Uploaded the new one.');

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('omar@example.com'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
        // The author is never written to about their own comment.
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
    }

    public function test_every_status_a_notice_can_announce_has_a_switch(): void
    {
        foreach (Status::ALL as $status) {
            if (in_array($status, [Status::DRAFT, Status::READY_FOR_DELIVERY], true)) {
                $this->assertNotContains($status, Copies::KINDS, $status.' is never announced');

                continue;
            }
            $this->assertContains($status, Copies::KINDS, $status.' is announced but has no switch');
        }

        $this->assertSame(
            [Copies::COMMENT],
            array_values(array_diff(Copies::KINDS, Status::ALL)),
            'the only switch that is not a status is the document comment',
        );
        $this->assertSame(Copies::KINDS, array_values(array_unique(Copies::KINDS)));
    }

    public function test_the_settings_page_lists_the_same_kinds_in_the_same_order(): void
    {
        $js = file_get_contents(public_path('js/settings.js'));
        $this->assertIsString($js);

        preg_match('/var PROVIDER_EMAIL_GROUPS = \[(.*?)\n  \];/s', $js, $block);
        $this->assertNotEmpty($block, 'PROVIDER_EMAIL_GROUPS not found in settings.js');

        preg_match_all("/\{ id: '([a-z_]+)'/", $block[1], $ids);
        $this->assertSame(Copies::KINDS, $ids[1]);
    }

    public function test_only_people_who_work_on_cip_files_are_offered_the_page(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $client = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        $providerAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'pat@galaxy.example', 'Pat Provider');

        $this->assertTrue(Role::canViewSettingsPage($officer, 'provider-emails'));
        $this->assertTrue(Role::canViewSettingsPage($admin, 'provider-emails'));
        $this->assertFalse(Role::canViewSettingsPage($client, 'provider-emails'));
        $this->assertFalse(Role::canViewSettingsPage($providerAdmin, 'provider-emails'));

        // No CIP, no notices, no page.
        config(['services.cip.enabled' => false]);
        $this->assertFalse(Role::canViewSettingsPage($officer, 'provider-emails'));
        $this->assertFalse(Role::canViewSettingsPage($admin, 'provider-emails'));
    }
}
