<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Notification;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use App\Support\Templates\SystemEmails;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Assigning someone to a service provider from Users sends one of four
 * dedicated notices: added or switched, each as admin or as contact. Never
 * the generic company-member letter, and never a combined added/switched
 * template.
 */
class ServiceProviderAssignmentMailTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config(['services.cip.enabled' => true]);
    }

    private function admin(): User
    {
        return $this->person(Role::ADMINISTRATOR, [
            'email' => 'tanya@tma.test',
            'name' => 'Tanya Antoine',
            'first_name' => 'Tanya',
        ]);
    }

    private function person(string $type, array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $o));
    }

    private function provider(string $name = 'Galaxy Consultants', string $code = 'GAL'): Company
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $name,
            'status' => 'active',
        ]);
        CipProvider::create([
            'name' => $name,
            'code' => $code,
            'company_id' => $company->id,
        ]);

        return $company->fresh();
    }

    private function sent(callable $match): Postcard
    {
        $found = null;
        Mail::assertSent(Postcard::class, function (Postcard $mail) use ($match, &$found) {
            if (! $match($mail)) {
                return false;
            }
            $found = $mail;

            return true;
        });
        $this->assertNotNull($found);

        return $found;
    }

    /** @param  array<int, string>  $needles */
    private function blob(Postcard $mail): string
    {
        $parts = [
            $mail->subjectLine,
            $mail->payload['preheader'] ?? null,
            $mail->payload['eyebrow'] ?? null,
            $mail->payload['greeting'] ?? null,
            $mail->payload['title'] ?? null,
            $mail->payload['lead'] ?? null,
            $mail->payload['bodyHtml'] ?? null,
            $mail->payload['footNote'] ?? null,
            $mail->payload['button']['label'] ?? null,
        ];
        foreach ($mail->payload['details'] ?? [] as $row) {
            $parts[] = $row[0].' '.$row[1];
        }

        return implode("\n", array_filter($parts));
    }

    public function test_the_catalog_keeps_added_and_switched_as_four_templates(): void
    {
        $keys = [
            'service-provider-admin-added',
            'service-provider-contact-added',
            'service-provider-admin-switched',
            'service-provider-contact-switched',
        ];
        foreach ($keys as $key) {
            $this->assertContains($key, SystemEmails::keys(), $key.' is missing from the catalog');
        }

        $adminAdded = SystemEmails::preview('service-provider-admin-added');
        $contactAdded = SystemEmails::preview('service-provider-contact-added');
        $adminSwitched = SystemEmails::preview('service-provider-admin-switched');
        $contactSwitched = SystemEmails::preview('service-provider-contact-switched');

        $this->assertStringContainsString('You have been added', $adminAdded['subject']);
        $this->assertStringContainsString('Service Provider admin', $adminAdded['html']);
        $this->assertStringNotContainsString('switched', strtolower($adminAdded['html'].$adminAdded['subject']));
        $this->assertStringNotContainsString('service provider contact', strtolower($adminAdded['html']));

        $this->assertStringContainsString('You have been added', $contactAdded['subject']);
        $this->assertStringContainsString('service provider contact', strtolower($contactAdded['html']));
        $this->assertStringNotContainsString('switched', strtolower($contactAdded['html'].$contactAdded['subject']));
        $this->assertStringNotContainsString('invite and remove', strtolower($contactAdded['html']));

        $this->assertStringContainsString('has been switched to', $adminSwitched['subject']);
        $this->assertStringContainsString('Service Provider admin', $adminSwitched['html']);
        $this->assertStringNotContainsString('You have been added', $adminSwitched['subject'].$adminSwitched['html']);

        $this->assertStringContainsString('has been switched to', $contactSwitched['subject']);
        $this->assertStringContainsString('service provider contact', strtolower($contactSwitched['html']));
        $this->assertStringNotContainsString('You have been added', $contactSwitched['subject'].$contactSwitched['html']);
        $this->assertStringNotContainsString('invite and remove', strtolower($contactSwitched['html']));
    }

    public function test_first_assignment_as_contact_sends_the_added_contact_email(): void
    {
        $admin = $this->admin();
        $company = $this->provider();
        $person = $this->person(Role::CLIENT, [
            'email' => 'priya@galaxy.test',
            'name' => 'Priya Sharma',
            'first_name' => 'Priya',
        ]);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $company->uid,
            ])
            ->assertOk();

        Mail::assertSent(Postcard::class, 1);
        $mail = $this->sent(fn (Postcard $m) => $m->hasTo('priya@galaxy.test'));
        $blob = $this->blob($mail);

        $this->assertStringContainsString('You have been added to Galaxy Consultants as a service provider contact', $mail->subjectLine);
        $this->assertStringContainsString('Hello Priya,', $blob);
        $this->assertStringContainsString('Tanya Antoine has added you', $blob);
        $this->assertStringContainsString('service provider contact', $blob);
        $this->assertStringNotContainsString('switched', strtolower($blob));
        $this->assertStringNotContainsString('Service Provider admin', $blob);
        $this->assertStringNotContainsString('You now have access', $mail->subjectLine);

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $person->id,
            'type' => 'company.member_added',
        ]);
    }

    public function test_first_assignment_as_admin_sends_the_added_admin_email(): void
    {
        $admin = $this->admin();
        $company = $this->provider();
        $person = $this->person(Role::CLIENT, [
            'email' => 'priya@galaxy.test',
            'name' => 'Priya Sharma',
            'first_name' => 'Priya',
        ]);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $company->uid,
                'admin' => true,
            ])
            ->assertOk();

        Mail::assertSent(Postcard::class, 1);
        $mail = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'Service Provider admin'));
        $blob = $this->blob($mail);

        $this->assertStringContainsString('You have been added to Galaxy Consultants as a Service Provider admin', $mail->subjectLine);
        $this->assertStringContainsString('invite and remove people', $blob);
        $this->assertStringNotContainsString('switched', strtolower($blob));
        $this->assertStringNotContainsString('service provider contact', strtolower($blob));
    }

    public function test_switching_firms_as_contact_sends_only_the_switched_contact_email(): void
    {
        $admin = $this->admin();
        $galaxy = $this->provider();
        $bluemina = $this->provider('Bluemina Partners', 'BLU');
        $person = $this->person(Role::CLIENT, [
            'email' => 'priya@galaxy.test',
            'name' => 'Priya Sharma',
            'first_name' => 'Priya',
        ]);
        CompanyMembers::add($galaxy, [
            'email' => $person->email,
            'name' => $person->name,
            'role' => CompanyRoles::MEMBER,
        ], $admin);

        Mail::fake();

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $bluemina->uid,
            ])
            ->assertOk();

        Mail::assertSent(Postcard::class, 1);
        $mail = $this->sent(fn (Postcard $m) => $m->hasTo('priya@galaxy.test'));
        $blob = $this->blob($mail);

        $this->assertStringContainsString('Your service provider has been switched to Bluemina Partners', $mail->subjectLine);
        $this->assertStringContainsString('You are a service provider contact there', $blob);
        $this->assertStringContainsString('Galaxy Consultants', $blob);
        $this->assertStringNotContainsString('You have been added', $blob);
        $this->assertStringNotContainsString('has been removed', $blob);
        $this->assertStringNotContainsString('You now have access', $mail->subjectLine);
        $this->assertStringNotContainsString('invite and remove', strtolower($blob));

        $this->assertFalse(CompanyMember::query()->active()
            ->where('user_id', $person->id)
            ->where('company_id', $galaxy->id)
            ->exists());
        $this->assertTrue(CompanyMember::query()->active()
            ->where('user_id', $person->id)
            ->where('company_id', $bluemina->id)
            ->exists());

        $this->assertNotNull(Notification::where('user_id', $person->id)
            ->where('type', 'company.role_changed')
            ->first());
    }

    public function test_switching_firms_as_admin_sends_only_the_switched_admin_email(): void
    {
        $admin = $this->admin();
        $galaxy = $this->provider();
        $bluemina = $this->provider('Bluemina Partners', 'BLU');
        $person = $this->person(Role::SERVICE_PROVIDER_ADMIN, [
            'email' => 'priya@galaxy.test',
            'name' => 'Priya Sharma',
            'first_name' => 'Priya',
        ]);
        CompanyMembers::add($galaxy, [
            'email' => $person->email,
            'name' => $person->name,
            'role' => CompanyRoles::MEMBER,
        ], $admin);

        Mail::fake();

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $bluemina->uid,
                'admin' => true,
            ])
            ->assertOk();

        Mail::assertSent(Postcard::class, 1);
        $mail = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'switched to Bluemina'));
        $blob = $this->blob($mail);

        $this->assertStringContainsString('You are a Service Provider admin there', $blob);
        $this->assertStringContainsString('invite and remove people', $blob);
        $this->assertStringContainsString('Galaxy Consultants', $blob);
        $this->assertStringNotContainsString('You have been added', $blob);
        $this->assertStringNotContainsString('service provider contact', strtolower($blob));
    }

    public function test_reassigning_the_same_firm_does_not_resend(): void
    {
        $admin = $this->admin();
        $company = $this->provider();
        $person = $this->person(Role::CLIENT, [
            'email' => 'priya@galaxy.test',
            'name' => 'Priya Sharma',
        ]);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $company->uid,
            ])
            ->assertOk();

        Mail::fake();

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $company->uid,
            ])
            ->assertOk();

        Mail::assertNothingSent();
    }
}
