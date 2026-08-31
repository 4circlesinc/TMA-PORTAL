<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Distribution;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §22 — CIP Console → Distribution group.
 *
 * Membership stays on People → Distribution groups. Extra mailboxes that
 * are not portal accounts are kept here so compliance mail is not env-only.
 */
class CipDistributionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Distribution::flush();
        $this->travelTo('2026-08-18 12:00:00');
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

    public function test_opening_the_page_creates_the_named_group_and_lists_its_people(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->assertNull(Distribution::group());

        $this->actingAs($admin)
            ->getJson('/portal/cip/distribution')
            ->assertOk()
            ->assertJsonPath('canEdit', true)
            ->assertJsonPath('groupName', 'CIP Distribution Group')
            ->assertJsonPath('members', [])
            ->assertJsonPath('extraEmails', []);

        $group = Distribution::group();
        $this->assertNotNull($group);
        $this->assertSame('CIP Distribution Group', $group->name);
        $this->assertFalse($group->is_archived);

        $kim = $this->user(Role::EMPLOYEE, 'kim@dist.example', 'Kim Dist');
        GroupMember::create([
            'group_id' => $group->id,
            'user_id' => $kim->id,
            'role' => GroupMember::ROLE_MEMBER,
        ]);

        $this->actingAs($admin)
            ->getJson('/portal/cip/distribution')
            ->assertOk()
            ->assertJsonPath('members.0.name', 'Kim Dist')
            ->assertJsonPath('members.0.email', 'kim@dist.example');
    }

    public function test_only_an_administrator_may_change_the_extra_mailboxes(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');

        $this->actingAs($officer)
            ->getJson('/portal/cip/distribution')
            ->assertOk()
            ->assertJsonPath('canEdit', false);

        $this->actingAs($officer)
            ->patchJson('/portal/cip/distribution', ['extraEmails' => ['watch@tma.example']])
            ->assertForbidden();
    }

    public function test_an_administrator_saves_extra_mailboxes_and_they_receive_the_next_notice(): void
    {
        Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);

        $saved = $this->actingAs($admin)
            ->patchJson('/portal/cip/distribution', [
                'extraEmails' => ['watch@tma.example', 'not-an-email', 'legal@tma.example', 'watch@tma.example'],
            ])
            ->assertOk()
            ->json('extraEmails');

        $this->assertSame(['watch@tma.example', 'legal@tma.example'], $saved);

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $admin);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        Engine::apply($application->fresh(), Status::DELAYED, null);

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('watch@tma.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('legal@tma.example'));
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
    }

    public function test_saving_an_empty_list_overrides_the_env_default(): void
    {
        config(['cip.distribution_emails' => ['env@example.com']]);
        Distribution::flush();
        $this->assertSame(['env@example.com'], Distribution::extraEmails());

        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)
            ->patchJson('/portal/cip/distribution', ['extraEmails' => []])
            ->assertOk()
            ->assertJsonPath('extraEmails', []);

        $this->assertSame([], Distribution::extraEmails());
    }

    public function test_the_module_must_be_on_to_reach_the_page(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        config(['services.cip.enabled' => false]);

        $this->actingAs($admin)->getJson('/portal/cip/distribution')->assertNotFound();
        $this->actingAs($admin)
            ->patchJson('/portal/cip/distribution', ['extraEmails' => []])
            ->assertNotFound();
    }
}
