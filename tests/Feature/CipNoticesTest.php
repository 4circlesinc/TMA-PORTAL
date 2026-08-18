<?php

namespace Tests\Feature;

use App\Mail\Postcard;
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
use App\Support\Cip\Engine;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * §22 — one subject format, four named classes, every status change.
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

        Assignments::assign($application->fresh(), $rita, $ada);

        $expected = 'AA - REVIEW APPLICATION - '.$application->fresh()->displayNumber()
            .' - CHEN WEI (F1) - 18.08.2026';

        foreach (['ada@example.com', 'rita@example.com', 'gil@galaxy.example', 'notices@galaxy.example', 'kim@dist.example'] as $mailbox) {
            Mail::assertSent(Postcard::class, fn (Postcard $mail) => $mail->subjectLine === $expected
                && $mail->hasTo($mailbox));
        }

        Mail::assertSentCount(5);
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

        Mail::assertSentCount(1);
        Mail::assertSent(Postcard::class, function (Postcard $mail) use ($application) {
            return $mail->subjectLine === 'DELAYED - '.$application->displayNumber()
                .' - CHEN WEI (F1) - 18.08.2026'
                && $mail->hasTo('ada@example.com');
        });
    }
}
