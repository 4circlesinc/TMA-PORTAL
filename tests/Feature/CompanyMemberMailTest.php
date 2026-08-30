<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Company add / invite / remove emails are complete notices, not a greeting
 * and a one-line stub. Access-change mail goes out even when the generic
 * notification twin would have been skipped.
 */
class CompanyMemberMailTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return $this->person('Administrator', ['email' => 'tanya@tma.test', 'name' => 'Tanya Antoine']);
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

    private function company(array $o = []): Company
    {
        return Company::create(array_merge([
            'uid' => 'galaxy',
            'name' => 'Galaxy Consultancy',
            'status' => 'active',
        ], $o));
    }

    private function providerCompany(): Company
    {
        $company = $this->company();
        CipProvider::create([
            'name' => $company->name,
            'code' => 'GAL',
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
    private function assertNoticeHas(Postcard $mail, array $needles): void
    {
        $blob = implode("\n", array_filter([
            $mail->subjectLine,
            $mail->payload['preheader'] ?? null,
            $mail->payload['eyebrow'] ?? null,
            $mail->payload['greeting'] ?? null,
            $mail->payload['title'] ?? null,
            $mail->payload['lead'] ?? null,
            $mail->payload['bodyHtml'] ?? null,
            $mail->payload['footNote'] ?? null,
            $mail->payload['button']['label'] ?? null,
        ]));
        foreach ($mail->payload['details'] ?? [] as $row) {
            $blob .= "\n".$row[0].' '.$row[1];
        }

        foreach ($needles as $needle) {
            $this->assertStringContainsString($needle, $blob, 'missing from the postcard: '.$needle);
        }

        $this->assertNotEmpty($mail->payload['greeting'] ?? null);
        $this->assertNotEmpty($mail->payload['title'] ?? null);
        $this->assertNotEmpty($mail->payload['lead'] ?? null);
        $this->assertNotEmpty($mail->payload['bodyHtml'] ?? null);
        $this->assertNotEmpty($mail->payload['details'] ?? []);
        $this->assertNotEmpty($mail->payload['button']['url'] ?? null);
        $this->assertNotEmpty($mail->payload['footNote'] ?? null);
    }

    public function test_inviting_a_member_sends_a_complete_invitation_not_a_done_notice(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->providerCompany();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.test',
            'role' => 'primary',
            'invite' => true,
        ])->assertCreated();

        $mail = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'Galaxy Consultancy'));

        $this->assertStringContainsString('invited', strtolower($mail->subjectLine));
        $this->assertStringNotContainsString('You have been added', $mail->subjectLine);
        $this->assertStringNotContainsString('bookings, events', $mail->payload['bodyHtml'] ?? '');
        $this->assertSame('Create your account', $mail->payload['button']['label'] ?? null);

        $this->assertNoticeHas($mail, [
            'Hello Dana Reed,',
            'Tanya Antoine has invited you',
            'Primary contact',
            'Citizenship by Investment',
            'create your account',
            'Invited by',
            'Expires',
        ]);
    }

    public function test_adding_an_existing_account_sends_a_full_access_notice(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->providerCompany();
        $existing = $this->person('Client', [
            'email' => 'dana@galaxy.test',
            'name' => 'Dana Reed',
        ]);

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.test',
            'role' => 'primary',
        ])->assertCreated();

        $mail = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'You now have access'));

        $this->assertStringNotContainsString('As Primary contact.', $mail->payload['bodyHtml'] ?? '');
        $this->assertSame('Open the portal', $mail->payload['button']['label'] ?? null);

        $this->assertNoticeHas($mail, [
            'Hello Dana Reed,',
            'Tanya Antoine has added you',
            'Primary contact',
            'already active',
            'Citizenship by Investment',
            'Sign in to the portal',
            'Added by',
        ]);

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $existing->id,
            'type' => 'company.member_added',
        ]);
        $bell = Notification::where('user_id', $existing->id)->where('type', 'company.member_added')->first();
        $this->assertStringNotContainsString('As Primary contact.', (string) $bell->message);
        $this->assertStringContainsString('applications', (string) $bell->message);
    }

    public function test_removing_a_member_explains_what_happened_and_what_to_do(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->providerCompany();
        $existing = $this->person('Client', [
            'email' => 'dana@galaxy.test',
            'name' => 'Dana Reed',
        ]);

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.test',
            'role' => 'member',
        ])->assertCreated()->json('member.id');

        $this->actingAs($admin)->deleteJson("/portal/companies/{$company->uid}/members/{$uuid}")
            ->assertOk();

        $mail = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'has been removed'));

        $this->assertNoticeHas($mail, [
            'Hello Dana Reed,',
            'Tanya Antoine has removed you',
            'Galaxy Consultancy',
            'access',
            'personal account is unchanged',
            'restore',
            'Removed by',
            'Sign in to the portal',
        ]);
        $this->assertStringContainsString('applications', $mail->payload['bodyHtml'] ?? '');

        $bell = Notification::where('user_id', $existing->id)->where('type', 'company.member_removed')->first();
        $this->assertNotNull($bell);
        $this->assertNotEmpty($bell->message);
    }

    public function test_a_plain_company_does_not_talk_about_cip_applications(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();
        $this->person('Client', ['email' => 'dana@galaxy.test', 'name' => 'Dana Reed']);

        $uuid = $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.test',
            'role' => 'member',
        ])->assertCreated()->json('member.id');

        $added = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'You now have access'));
        $this->assertStringNotContainsString('Citizenship by Investment', $added->payload['bodyHtml'] ?? '');
        $this->assertStringContainsString('files, documents and updates', $added->payload['bodyHtml'] ?? '');

        $this->actingAs($admin)->deleteJson("/portal/companies/{$company->uid}/members/{$uuid}")
            ->assertOk();

        $removed = $this->sent(fn (Postcard $m) => str_contains($m->subjectLine, 'has been removed'));
        $this->assertStringNotContainsString('Citizenship by Investment', $removed->payload['bodyHtml'] ?? '');
    }

    public function test_adding_without_an_account_still_sends_nothing_until_invited(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $company = $this->company();

        $this->actingAs($admin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.test',
            'role' => 'member',
        ])->assertCreated();

        Mail::assertNothingSent();
        $this->assertSame(0, CompanyMember::where('status', 'active')->count());
    }
}
