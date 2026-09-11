<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\Distribution;
use App\Support\Cip\Engine;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Section 22 — one subject format, four named classes, every status change.
 *
 * Chips still say Approved and Review Applications. Email subjects say
 * GRANTED and REVIEW APPLICATION. Engine is the only sender: a delay or a
 * decision must not put two copies of the same news in the same inbox.
 */
class CipNoticesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Distribution::flush();
        $this->travelTo('2026-08-18 12:00:00');
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    public function test_the_subject_uses_the_filing_tokens_not_the_chip_labels(): void
    {
        $kim = $this->user(Role::ADMINISTRATOR, 'kim@example.com', 'Kim Morgan');
        $facts = ['number' => 'GAL26-00001', 'applicant' => 'John Smith', 'familySize' => 4];

        $this->assertSame(
            'KM - NEW APPLICATION - GAL26-00001 - JOHN SMITH (F4) - 18.08.2026',
            Notices::line($facts, Status::NEW, $kim),
        );
        $this->assertSame(
            'KM - REVIEW APPLICATION - GAL26-00001 - JOHN SMITH (F4) - 18.08.2026',
            Notices::line($facts, Status::REVIEW_APPLICATION, $kim),
        );
        $this->assertSame(
            'KM - ASSESSMENT FEEDBACK - GAL26-00001 - JOHN SMITH (F4) - 18.08.2026',
            Notices::line($facts, Status::ASSESSMENT_FEEDBACK, $kim),
        );
        $this->assertSame(
            'KM - UPDATE REQUIRED - GAL26-00001 - JOHN SMITH (F4) - 18.08.2026',
            Notices::line($facts, Status::UPDATE_REQUIRED, $kim),
        );
        $this->assertSame(
            'KM - READY TO SUBMIT - GAL26-00001 - JOHN SMITH (F4) - 18.08.2026',
            Notices::line($facts, Status::READY_TO_SUBMIT, $kim),
        );
        $this->assertSame(
            'KM - PENDING REVIEW - 10T1G12661P - JOHN SMITH (F4) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'John Smith', 'familySize' => 4], Status::PENDING_REVIEW, $kim),
        );
        $this->assertSame(
            'KM - NON-COMPLIANT - 10T1G12661P - JOHN SMITH (F4) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'John Smith', 'familySize' => 4], Status::NON_COMPLIANT, $kim),
        );
        $this->assertSame(
            'KM - BACKGROUND CHECK - 10T1G12661P - JOHN SMITH (F4) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'John Smith', 'familySize' => 4], Status::BACKGROUND_CHECK, $kim),
        );
        $this->assertSame(
            'KM - DELAYED - 10T1G12661P - JOHN SMITH (F4) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'John Smith', 'familySize' => 4], Status::DELAYED, $kim),
        );
        $this->assertSame(
            'KM - GRANTED - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::GRANTED, $kim),
        );
        $this->assertSame(
            'KM - POST APPROVAL - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::POST_APPROVAL, $kim),
        );
        $this->assertSame(
            'KM - APPLY FOR COR - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::APPLY_FOR_COR, $kim),
        );
        $this->assertSame(
            'KM - PENDING COR - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::PENDING_COR, $kim),
        );
        $this->assertSame(
            'KM - APPLY FOR NIC - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::APPLY_FOR_NIC, $kim),
        );
        $this->assertSame(
            'KM - PENDING NIC - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::PENDING_NIC, $kim),
        );
        $this->assertSame(
            'KM - APPLY FOR PASSPORT - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::APPLY_FOR_PASSPORT, $kim),
        );
        $this->assertSame(
            'KM - PENDING PASSPORT - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::PENDING_PASSPORT, $kim),
        );
        $this->assertSame(
            'KM - READY FOR DELIVERY - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::READY_FOR_DELIVERY, $kim),
        );
        $this->assertSame(
            'KM - FILE CLOSED - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::CLOSED, $kim),
        );
        $this->assertSame(
            'KM - DENIED - 10T1G12661P - ASEM HABTOOR (F6) - 18.08.2026',
            Notices::line(['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6], Status::DENIED, $kim),
        );
        $this->assertStringNotContainsString('APPROVED', Notices::line(
            ['number' => '10T1G12661P', 'applicant' => 'Asem Habtoor', 'familySize' => 6],
            Status::GRANTED,
            $kim,
        ));
    }

    public function test_creating_an_application_does_not_send_new_application(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        Applications::create($provider, $ada);

        Mail::assertNothingSent();
    }

    public function test_the_four_named_classes_are_told_including_the_distribution_group(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        $kim = $this->user(Role::EMPLOYEE, 'kim@dist.example', 'Kim Dist');

        $group = Group::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'CIP Distribution Group',
            'group_type' => Group::TYPE_TEAM,
            'created_by' => $ada->id,
        ]);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $kim->id, 'role' => GroupMember::ROLE_MEMBER]);

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $ada->id]);
        $provider = CipProvider::create([
            'name' => 'Galaxy',
            'code' => 'GAL',
            'company_id' => $company->id,
            'contact_email' => 'notices@galaxy.example',
            'contact_name' => 'Galaxy Notices',
        ]);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $gil->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $ada->id,
        ]);

        $application = Applications::create($provider, $ada);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        Distribution::putExtraEmails(['watch@tma.example']);

        Assignments::assign($application->fresh(), $rita, $ada);

        $expected = 'AA - REVIEW APPLICATION - '.$application->fresh()->displayNumber()
            .' - CHEN WEI (F1) - 18.08.2026';

        foreach ([
            'ada@example.com', 'rita@example.com', 'gil@galaxy.example',
            'notices@galaxy.example', 'kim@dist.example', 'watch@tma.example',
        ] as $mailbox) {
            Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->subjectLine === $expected
                && $mail->hasTo($mailbox));
        }

        Mail::assertQueuedCount(6);

        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'kim@dist.example',
            'template' => 'cip-assigned',
            'related_id' => $application->id,
            'related_type' => CipApplication::class,
        ]);
        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'watch@tma.example',
            'template' => 'cip-assigned',
            'related_id' => $application->id,
            'related_type' => CipApplication::class,
        ]);
    }

    /**
     * The Assessment Feedback fork.
     *
     * After review the file sits at ASSESSMENT FEEDBACK and goes one of two
     * ways. Updates Required is the provider's to act on, so their contact is
     * told; Ready to Submit carries the file on toward submission. Both are
     * status changes, so both are section 22 notices — this pins which of them
     * reaches the service provider, and that the fork offers nothing else.
     */
    public function test_assessment_feedback_tells_the_provider_when_updates_are_required(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $ada->id]);
        $provider = CipProvider::create([
            'name' => 'Galaxy',
            'code' => 'GAL',
            'company_id' => $company->id,
        ]);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $gil->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $ada->id,
        ]);

        $application = Applications::create($provider, $ada);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        Assignments::assign($application->fresh(), $rita, $ada);

        // Assigning is what starts the review, so the file is already at
        // Review Applications by the time the officer has assessed it.
        Engine::apply($application->fresh(), Status::ASSESSMENT_FEEDBACK, $rita);

        // The fork itself: those two, and nothing else.
        $at = $application->fresh();
        $this->assertTrue(Engine::canTransition($at, Status::UPDATE_REQUIRED));
        $this->assertTrue(Engine::canTransition($at, Status::READY_TO_SUBMIT));
        $this->assertFalse(Engine::canTransition($at, Status::PENDING_REVIEW));
        $this->assertFalse(Engine::canTransition($at, Status::GRANTED));

        Mail::fake();
        Engine::apply($application->fresh(), Status::UPDATE_REQUIRED, $rita);

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        $expected = 'RO - UPDATE REQUIRED - '.$application->fresh()->displayNumber()
            .' - CHEN WEI (F1) - 18.08.2026';

        // The service provider is told, in the filing subject format.
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->subjectLine === $expected
            && $mail->hasTo('gil@galaxy.example'));

        // And it reaches them in the portal, not only by email.
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $gil->id,
            'subject_id' => $application->id,
            'subject_type' => CipApplication::class,
        ]);
    }

    public function test_ready_to_submit_carries_the_file_toward_submission(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $application = Applications::create($provider, $ada);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        Assignments::assign($application->fresh(), $rita, $ada);

        // Assigning is what starts the review, so the file is already at
        // Review Applications by the time the officer has assessed it.
        Engine::apply($application->fresh(), Status::ASSESSMENT_FEEDBACK, $rita);
        Engine::apply($application->fresh(), Status::READY_TO_SUBMIT, $rita);

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);

        // Submission is the next step, not a second trip through the feedback.
        $this->assertTrue(Engine::canTransition($application->fresh(), Status::PENDING_REVIEW));
    }

    public function test_a_person_in_two_classes_is_still_one_mailbox(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $group = Group::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'CIP Distribution Group',
            'group_type' => Group::TYPE_TEAM,
            'created_by' => $ada->id,
        ]);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $ada->id, 'role' => GroupMember::ROLE_MEMBER]);

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $ada);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        Mail::assertQueuedCount(1);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
    }

    public function test_a_status_change_is_one_notice_per_recipient(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $ada);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        Mail::assertQueuedCount(1);
        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($application) {
            return $mail->subjectLine === 'DELAYED - '.$application->displayNumber()
                .' - CHEN WEI (F1) - 18.08.2026'
                && $mail->hasTo('ada@example.com');
        });
    }

    /**
     * Settings › Notifications › Copy me on service provider emails.
     *
     * The firm's own people are copied on what the provider side is sent, and
     * that copy is theirs to decline: the email stops, the bell does not. An
     * administrator is copied on every application and an officer on the
     * files they hold, so the switch reaches exactly that far. The provider
     * side is the addressee rather than a copy, and the same flag on a
     * contact's account changes nothing.
     */
    public function test_a_staff_member_may_decline_the_email_copy_and_keep_the_bell(): void
    {
        Mail::fake();

        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $bob = $this->user(Role::ADMINISTRATOR, 'bob@example.com', 'Bob Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        foreach ([$bob, $rita, $gil] as $declined) {
            $declined->forceFill(['preferences' => ['notifyProviderCopies' => false]])->save();
        }

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $ada->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $gil->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $ada->id,
        ]);

        $application = Applications::create($provider, $ada);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        Assignments::assign($application->fresh(), $rita, $ada);

        // The provider side and the administrator who kept the copy are written to.
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
        // The two who declined are not, and nothing was recorded as sent to them.
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('bob@example.com'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertQueuedCount(2);
        $this->assertDatabaseMissing('email_deliveries', ['recipient' => 'bob@example.com']);
        $this->assertDatabaseMissing('email_deliveries', ['recipient' => 'rita@example.com']);

        // Declining the copy silences nothing in the portal.
        foreach ([$bob, $rita] as $declined) {
            $this->assertDatabaseHas('portal_notifications', [
                'user_id' => $declined->id,
                'subject_id' => $application->id,
                'subject_type' => CipApplication::class,
            ]);
        }
    }
}
