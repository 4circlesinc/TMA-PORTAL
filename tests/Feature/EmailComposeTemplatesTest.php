<?php

namespace Tests\Feature;

use App\Models\Template;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Templates\ComposeTemplates;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Firm compose templates: administrators write them on the Templates page,
 * anyone with a mailbox picks one in compose and fills in the blanks.
 */
class EmailComposeTemplatesTest extends TestCase
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

    public function test_an_administrator_can_create_edit_and_delete_one(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $created = $this->actingAs($admin)
            ->postJson('/portal/templates/email-templates', [
                'name' => 'Engagement follow-up',
                'subject' => 'Following up on your engagement',
                'body' => "Dear ____,\n\nThank you for meeting with us on ____. **Next steps** are below.\n\n- Sign the engagement letter\n- Upload your documents",
            ])
            ->assertCreated()
            ->json();

        $this->assertSame('Engagement follow-up', $created['name']);
        $this->assertStringContainsString('<strong>Next steps</strong>', $created['bodyHtml']);
        $this->assertStringContainsString('<ul><li>Sign the engagement letter</li>', $created['bodyHtml']);

        $listed = $this->actingAs($admin)
            ->getJson('/portal/templates/email-templates')
            ->assertOk()
            ->json();
        $this->assertCount(1, $listed['templates']);

        $this->actingAs($admin)
            ->patchJson('/portal/templates/email-templates/'.$created['id'], [
                'name' => 'Engagement follow-up',
                'subject' => 'A quick follow-up',
                'body' => 'Dear ____,',
            ])
            ->assertOk()
            ->assertJsonPath('subject', 'A quick follow-up');

        $this->actingAs($admin)
            ->deleteJson('/portal/templates/email-templates/'.$created['id'])
            ->assertOk();

        $this->assertSame(0, Template::query()->where('kind', ComposeTemplates::KIND)->count());
    }

    public function test_a_name_subject_and_body_are_all_required(): void
    {
        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->postJson('/portal/templates/email-templates', ['name' => 'X'])
            ->assertStatus(422);
    }

    public function test_managing_is_administrators_only(): void
    {
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->postJson('/portal/templates/email-templates', [
                'name' => 'X', 'subject' => 'Y', 'body' => 'Z',
            ])
            ->assertForbidden();

        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->getJson('/portal/templates/email-templates')
            ->assertForbidden();
    }

    public function test_the_mailbox_listing_is_for_anyone_with_a_mailbox(): void
    {
        Template::create([
            'kind' => ComposeTemplates::KIND,
            'key' => 'k1',
            'name' => 'Welcome pack',
            'fields' => ['subject' => 'Your welcome pack', 'body' => 'Dear ____,'],
        ]);

        $listed = $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->getJson('/portal/mail/templates')
            ->assertOk()
            ->json();

        $this->assertCount(1, $listed['templates']);
        $this->assertSame('Welcome pack', $listed['templates'][0]['name']);
        $this->assertSame('<p>Dear ____,</p>', $listed['templates'][0]['bodyHtml']);
        $this->assertArrayNotHasKey('body', $listed['templates'][0], 'the mailbox gets rendered HTML, not source');

        // No mailbox capability, no listing.
        $this->actingAs($this->user(Role::CLIENT))
            ->getJson('/portal/mail/templates')
            ->assertForbidden();
    }

    public function test_the_preview_renders_the_draft_body(): void
    {
        $preview = $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->postJson('/portal/templates/email-templates/preview', [
                'subject' => 'S',
                'body' => 'Hello **there** — https://tma.test',
            ])
            ->assertOk()
            ->json();

        $this->assertStringContainsString('<strong>there</strong>', $preview['html']);
        $this->assertStringContainsString('<a href="https://tma.test"', $preview['html']);
    }
}
