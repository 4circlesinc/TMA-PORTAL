<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Notification;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\Delay;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §20 — 180 days after Accepted for processing, with no decision: Delayed.
 *
 * The daily command is the door. It flips the status once, tells the three
 * named classes, and a second tick does not re-notify.
 */
class CipDelayTest extends TestCase
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

    /**
     * A file in Background check, accepted `$days` ago, with the three
     * recipient classes the brief names standing behind it.
     *
     * @return array{0: CipApplication, 1: User, 2: User, 3: User}
     */
    private function overdue(int $days = 181): array
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $admin->id]);
        $provider = CipProvider::create([
            'name' => 'Galaxy',
            'code' => 'GAL',
            'company_id' => $company->id,
            'contact_email' => 'notices@galaxy.example',
            'contact_name' => 'Galaxy Notices',
        ]);
        $application = Applications::create($provider, $admin);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        $application->forceFill([
            'status' => Status::BACKGROUND_CHECK,
            'cip_number' => '10T1G12661P',
            'submitted_at' => now()->subDays($days + 30)->toDateString(),
            'accepted_at' => now()->subDays($days)->toDateString(),
            'locked_at' => now(),
        ])->save();

        Assignments::assign($application->fresh(), $officer, $admin);

        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $admin->id,
        ]);

        return [$application->refresh(), $admin, $officer, $contact];
    }

    public function test_an_application_accepted_181_days_ago_becomes_delayed_exactly_once(): void
    {
        [$application, $admin, $officer, $contact] = $this->overdue(181);
        Mail::fake();

        $this->artisan('cip:flag-delayed')
            ->expectsOutput('Flagged 1 delayed application(s).')
            ->assertSuccessful();

        $fresh = $application->fresh();
        $this->assertSame(Status::DELAYED, $fresh->status);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::BACKGROUND_CHECK,
            'to_status' => Status::DELAYED,
            'actor_id' => null,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_DELAYED,
            'actor_id' => null,
        ]);

        $expected = 'RO - DELAYED - 10T1G12661P - CHEN WEI (F1) - '.now()->format('d.m.Y');

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($expected) {
            return $mail->subjectLine === $expected
                && $mail->hasTo('ada@example.com');
        });
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('rita@example.com'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gil@galaxy.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('notices@galaxy.example'));
        Mail::assertQueued(Postcard::class, 4);

        foreach ([$admin, $officer, $contact] as $user) {
            $this->assertDatabaseHas('portal_notifications', [
                'user_id' => $user->id, 'type' => 'cip.delayed',
            ]);
        }

        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'ada@example.com', 'template' => 'cip-delayed',
        ]);

        $events = CipEvent::count();
        $mails = 4;

        $this->artisan('cip:flag-delayed')
            ->expectsOutput('Flagged 0 delayed application(s).')
            ->assertSuccessful();

        $this->assertSame(Status::DELAYED, $application->fresh()->status);
        $this->assertSame($events, CipEvent::count(), 'a second tick wrote another event');
        Mail::assertQueued(Postcard::class, $mails);
        $this->assertSame(3, Notification::where('type', 'cip.delayed')->count());
    }

    public function test_179_days_is_not_delayed(): void
    {
        [$application] = $this->overdue(179);
        Mail::fake();

        $this->artisan('cip:flag-delayed')
            ->expectsOutput('Flagged 0 delayed application(s).')
            ->assertSuccessful();

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        Mail::assertNothingSent();
        $this->assertDatabaseMissing('cip_events', [
            'application_id' => $application->id,
            'to_status' => Status::DELAYED,
        ]);
    }

    public function test_the_180th_day_is_delayed(): void
    {
        [$application] = $this->overdue(180);
        Mail::fake();

        $this->artisan('cip:flag-delayed')->assertSuccessful();

        $this->assertSame(Status::DELAYED, $application->fresh()->status);
    }

    public function test_a_file_with_a_decision_is_left_alone(): void
    {
        [$application] = $this->overdue(181);
        $application->forceFill([
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now()->toDateString(),
        ])->save();
        Mail::fake();

        $this->artisan('cip:flag-delayed')->assertSuccessful();

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        Mail::assertNothingSent();
    }

    public function test_the_command_is_inert_while_the_module_is_dark(): void
    {
        [$application] = $this->overdue(181);
        config(['services.cip.enabled' => false]);
        Mail::fake();

        $this->artisan('cip:flag-delayed')
            ->expectsOutput('CIP is disabled (FEATURE_CIP).')
            ->assertSuccessful();

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        Mail::assertNothingSent();
    }

    public function test_an_administrator_who_also_holds_the_file_is_one_recipient(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $admin);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill([
            'status' => Status::BACKGROUND_CHECK,
            'cip_number' => '10T1G12661P',
            'accepted_at' => now()->subDays(181)->toDateString(),
        ])->save();
        Assignments::assign($application->fresh(), $admin, $admin);

        $addresses = array_column(Delay::recipients($application->fresh()), 'email');
        $this->assertSame(['ada@example.com'], $addresses);
    }
}
