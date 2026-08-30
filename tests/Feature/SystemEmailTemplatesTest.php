<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Status;
use App\Support\Mail\Postcards;
use App\Support\Templates\Markup;
use App\Support\Templates\SystemEmails;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The Templates page's system emails: every transactional email's copy is
 * editable by an administrator, placeholders fill at send time, the shipped
 * default is always one restore away, and a typo'd placeholder is caught at
 * the desk rather than discovered in a customer's inbox.
 */
class SystemEmailTemplatesTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_the_listing_is_administrators_only(): void
    {
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->getJson('/portal/templates/system-emails')
            ->assertForbidden();

        $this->actingAs($this->user(Role::CLIENT))
            ->getJson('/portal/templates/system-emails')
            ->assertForbidden();

        $listing = $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->getJson('/portal/templates/system-emails')
            ->assertOk()
            ->json();

        $keys = collect($listing['templates'])->pluck('key')->all();
        $this->assertSame(SystemEmails::keys(), $keys, 'the listing should carry every catalog template');

        foreach ($listing['templates'] as $template) {
            $this->assertNotSame('', $template['name']);
            $this->assertNotSame('', $template['category']);
            $this->assertNotEmpty($template['editable'], $template['key'].' offers nothing to edit');
        }
    }

    public function test_every_template_previews_from_its_shipped_copy(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        foreach (SystemEmails::keys() as $key) {
            $preview = $this->actingAs($admin)
                ->postJson('/portal/templates/system-emails/'.$key.'/preview')
                ->assertOk()
                ->json();

            $this->assertNotSame('', trim($preview['subject']), $key.' previews with no subject');
            $this->assertStringNotContainsString('{{', $preview['html'], $key.' leaks an unfilled placeholder');
            $this->assertStringNotContainsString('{{', $preview['subject'], $key.' leaks a placeholder in the subject');
        }
    }

    public function test_an_edit_changes_what_is_sent(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)
            ->patchJson('/portal/templates/system-emails/verify-email', ['fields' => [
                'subject' => 'One more step, {{name}}',
                'body' => "Press the button and **{{name}}** is all set.\n\nQuestions? support@tmantoine.com.",
            ]])
            ->assertOk()
            ->assertJsonPath('customized', true);

        $mail = Postcards::verifyEmail('https://portal.test/verify/abc', 'Ada');

        $this->assertSame('One more step, Ada', $mail->subjectLine);
        $this->assertStringContainsString('<strong>Ada</strong>', $mail->payload['bodyHtml']);
        $this->assertStringContainsString('mailto:support@tmantoine.com', $mail->payload['bodyHtml']);
        $this->assertSame('https://portal.test/verify/abc', $mail->payload['button']['url'], 'the button URL is not editable copy');
        // Untouched fields keep the shipped copy.
        $this->assertSame('Confirm email address', $mail->payload['button']['label']);
    }

    public function test_an_unknown_placeholder_is_rejected(): void
    {
        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->patchJson('/portal/templates/system-emails/verify-email', ['fields' => [
                'title' => 'Hello {{nmae}}',
            ]])
            ->assertStatus(422);

        $this->assertFalse(SystemEmails::isCustomized('verify-email'));
    }

    public function test_the_subject_cannot_be_emptied(): void
    {
        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->patchJson('/portal/templates/system-emails/verify-email', ['fields' => [
                'subject' => '   ',
            ]])
            ->assertStatus(422);
    }

    public function test_restore_returns_to_the_shipped_copy(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)
            ->patchJson('/portal/templates/system-emails/reset-password', ['fields' => [
                'subject' => 'Pick a new password',
            ]])
            ->assertOk();
        $this->assertSame('Pick a new password', Postcards::resetPassword('https://x.test')->subjectLine);

        $this->actingAs($admin)
            ->postJson('/portal/templates/system-emails/reset-password/restore')
            ->assertOk()
            ->assertJsonPath('customized', false);

        $this->assertSame('Reset your password', Postcards::resetPassword('https://x.test')->subjectLine);
    }

    public function test_saving_the_default_back_is_not_a_customization(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $defaults = SystemEmails::defaults('team-added');

        $this->actingAs($admin)
            ->patchJson('/portal/templates/system-emails/team-added', ['fields' => $defaults])
            ->assertOk()
            ->assertJsonPath('customized', false);
    }

    public function test_a_cip_subject_stays_in_the_filing_format(): void
    {
        $listing = $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->getJson('/portal/templates/system-emails')
            ->assertOk()
            ->json();

        $cip = collect($listing['templates'])->firstWhere('key', 'cip-status');
        $this->assertTrue($cip['subjectFixed']);
        $this->assertNotContains('subject', $cip['editable']);

        // A subject smuggled into the save is ignored, not stored.
        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->patchJson('/portal/templates/system-emails/cip-status', ['fields' => ['subject' => 'prose subject']])
            ->assertOk()
            ->assertJsonPath('customized', false);
    }

    public function test_only_administrators_can_edit(): void
    {
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->patchJson('/portal/templates/system-emails/verify-email', ['fields' => ['subject' => 'x']])
            ->assertForbidden();
    }

    public function test_conditional_copy_follows_its_variable(): void
    {
        $with = Postcards::signatureInvitation('Lease.pdf', 'Vernon Francis', null, 'https://x.test', 'Dana', null, 'sign');
        $without = Postcards::signatureInvitation('Lease.pdf', null, null, 'https://x.test', null, null, 'sign');

        $this->assertSame('Vernon Francis asked you to sign a document', $with['title']);
        $this->assertSame('A document needs your signature', $without['title']);
        $this->assertSame('Hi Dana,', $with['greeting']);
        $this->assertArrayNotHasKey('greeting', $without);
        $this->assertSame('Please sign: Lease.pdf', $with['subject']);
    }

    public function test_each_cip_status_email_is_its_own_template(): void
    {
        $facts = ['number' => 'GAL26-00004', 'applicant' => 'Testing Francis', 'provider' => 'Galaxy Partners', 'familySize' => 1];

        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->patchJson('/portal/templates/system-emails/cip-status-assessment-feedback', ['fields' => [
                'lead' => 'Our team is assessing {{applicant}}’s documents.',
            ]])
            ->assertOk()
            ->assertJsonPath('customized', true);

        $feedback = Postcards::cipStatus($facts, Status::ASSESSMENT_FEEDBACK, 'https://x.test', 'Travis Grant', 'SUBJ-AF');
        $check = Postcards::cipStatus($facts, Status::BACKGROUND_CHECK, 'https://x.test', 'Travis Grant', 'SUBJ-BC');

        $this->assertSame('Our team is assessing Testing Francis’s documents.', $feedback->payload['lead']);
        $this->assertSame('Testing Francis’s application now stands at Background Check.', $check->payload['lead'], 'the sibling status must keep its own copy');
        $this->assertSame('Hi Travis,', $feedback->payload['greeting']);
        $this->assertSame('SUBJ-AF', $feedback->subjectLine, 'the filing subject stays with the caller');
        $this->assertSame('GAL26-00004: Assessment Feedback', $feedback->payload['title']);
    }

    public function test_the_markup_escapes_what_people_typed(): void
    {
        $html = Markup::html(
            "See **{{name}}** at [the portal]({{url}}) or https://tma.test — write support@tmantoine.com.\n\n- one\n- two",
            ['name' => '<script>x</script>', 'url' => 'https://portal.test/a?b=1&c=2'],
        );

        $this->assertStringContainsString('&lt;script&gt;', $html);
        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('<a href="https://portal.test/a?b=1&amp;c=2"', $html);
        $this->assertStringContainsString('>the portal</a>', $html);
        $this->assertStringContainsString('<a href="https://tma.test"', $html);
        $this->assertStringContainsString('<a href="mailto:support@tmantoine.com"', $html);
        $this->assertStringContainsString('<ul><li>one</li><li>two</li></ul>', $html);
    }
}
