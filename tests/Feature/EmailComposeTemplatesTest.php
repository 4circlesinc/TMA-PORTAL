<?php

namespace Tests\Feature;

use App\Models\Template;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Templates\ComposeTemplates;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Compose templates: staff write their own on Templates → Email templates,
 * administrators can publish firm defaults, anyone with a mailbox picks one
 * in compose and fills in the blanks.
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

    public function test_an_administrator_can_create_edit_and_delete_a_firm_default(): void
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
        $this->assertTrue($created['shared']);
        $this->assertTrue($created['canEdit']);
        $this->assertStringContainsString('<strong>Next steps</strong>', $created['bodyHtml']);
        $this->assertStringContainsString('<ul><li>Sign the engagement letter</li>', $created['bodyHtml']);
        $this->assertNull(Template::query()->where('uuid', $created['id'])->value('user_id'));

        $listed = $this->actingAs($admin)
            ->getJson('/portal/templates/email-templates')
            ->assertOk()
            ->json();
        $this->assertTrue($listed['canShareDefaults']);
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

    public function test_an_administrator_can_keep_a_template_just_for_themselves(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $created = $this->actingAs($admin)
            ->postJson('/portal/templates/email-templates', [
                'name' => 'My scratch pad',
                'subject' => 'Scratch',
                'body' => 'Notes',
                'shared' => false,
            ])
            ->assertCreated()
            ->json();

        $this->assertFalse($created['shared']);
        $this->assertTrue($created['mine']);
        $this->assertSame($admin->id, Template::query()->where('uuid', $created['id'])->value('user_id'));
    }

    public function test_a_name_subject_and_body_are_all_required(): void
    {
        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->postJson('/portal/templates/email-templates', ['name' => 'X'])
            ->assertStatus(422);
    }

    public function test_an_officer_can_create_and_manage_their_own_template(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $created = $this->actingAs($officer)
            ->postJson('/portal/templates/email-templates', [
                'name' => 'My follow-up',
                'subject' => 'Following up',
                'body' => 'Dear ____,',
                'shared' => true,
            ])
            ->assertCreated()
            ->json();

        $this->assertFalse($created['shared'], 'officers cannot publish a firm default');
        $this->assertTrue($created['mine']);
        $this->assertSame($officer->id, Template::query()->where('uuid', $created['id'])->value('user_id'));

        $this->actingAs($officer)
            ->getJson('/portal/templates/email-templates')
            ->assertOk()
            ->assertJsonPath('canShareDefaults', false)
            ->assertJsonCount(1, 'templates');

        $this->actingAs($officer)
            ->patchJson('/portal/templates/email-templates/'.$created['id'], [
                'name' => 'My follow-up',
                'subject' => 'A quick follow-up',
                'body' => 'Hello,',
            ])
            ->assertOk()
            ->assertJsonPath('subject', 'A quick follow-up');

        $this->actingAs($officer)
            ->deleteJson('/portal/templates/email-templates/'.$created['id'])
            ->assertOk();
    }

    public function test_an_officer_cannot_edit_or_delete_a_firm_default(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $firm = Template::create([
            'kind' => ComposeTemplates::KIND,
            'key' => 'k-firm',
            'name' => 'Welcome pack',
            'fields' => ['subject' => 'Your welcome pack', 'body' => 'Dear ____,'],
        ]);

        $this->actingAs($officer)
            ->getJson('/portal/templates/email-templates')
            ->assertOk()
            ->assertJsonCount(1, 'templates')
            ->assertJsonPath('templates.0.canEdit', false)
            ->assertJsonPath('templates.0.shared', true);

        $this->actingAs($officer)
            ->patchJson('/portal/templates/email-templates/'.$firm->uuid, [
                'name' => 'Welcome pack',
                'subject' => 'Changed',
                'body' => 'No.',
            ])
            ->assertForbidden();

        $this->actingAs($officer)
            ->deleteJson('/portal/templates/email-templates/'.$firm->uuid)
            ->assertForbidden();

        $this->actingAs($admin)
            ->getJson('/portal/templates/system-emails')
            ->assertOk();

        $this->actingAs($officer)
            ->getJson('/portal/templates/system-emails')
            ->assertForbidden();
    }

    public function test_personal_templates_are_not_visible_to_a_colleague(): void
    {
        $owner = $this->user(Role::REVIEWING_OFFICER);
        $colleague = $this->user(Role::REVIEWING_OFFICER);

        $mine = Template::create([
            'kind' => ComposeTemplates::KIND,
            'key' => 'k-mine',
            'name' => 'Private opener',
            'fields' => ['subject' => 'Hi', 'body' => 'Hello,'],
            'user_id' => $owner->id,
        ]);

        $this->actingAs($colleague)
            ->getJson('/portal/templates/email-templates')
            ->assertOk()
            ->assertJsonCount(0, 'templates');

        $this->actingAs($colleague)
            ->getJson('/portal/mail/templates')
            ->assertOk()
            ->assertJsonCount(0, 'templates');

        $this->actingAs($colleague)
            ->patchJson('/portal/templates/email-templates/'.$mine->uuid, [
                'name' => 'Private opener',
                'subject' => 'Stolen',
                'body' => 'No.',
            ])
            ->assertNotFound();
    }

    public function test_the_mailbox_listing_is_for_anyone_with_a_mailbox(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);

        Template::create([
            'kind' => ComposeTemplates::KIND,
            'key' => 'k1',
            'name' => 'Welcome pack',
            'fields' => ['subject' => 'Your welcome pack', 'body' => 'Dear ____,'],
        ]);

        Template::create([
            'kind' => ComposeTemplates::KIND,
            'key' => 'k-mine',
            'name' => 'My opener',
            'fields' => ['subject' => 'Hello', 'body' => 'Hi,'],
            'user_id' => $officer->id,
        ]);

        $listed = $this->actingAs($officer)
            ->getJson('/portal/mail/templates')
            ->assertOk()
            ->json();

        $this->assertCount(2, $listed['templates']);
        $names = array_column($listed['templates'], 'name');
        $this->assertContains('Welcome pack', $names);
        $this->assertContains('My opener', $names);
        $this->assertSame('<p>Dear ____,</p>', collect($listed['templates'])->firstWhere('name', 'Welcome pack')['bodyHtml']);
        $this->assertArrayNotHasKey('body', $listed['templates'][0], 'the mailbox gets rendered HTML, not source');
        $this->assertTrue(collect($listed['templates'])->firstWhere('name', 'Welcome pack')['shared']);
        $this->assertFalse(collect($listed['templates'])->firstWhere('name', 'My opener')['shared']);

        $this->actingAs($this->user(Role::CLIENT))
            ->getJson('/portal/mail/templates')
            ->assertForbidden();

        $this->actingAs($this->user(Role::CLIENT))
            ->getJson('/portal/templates/email-templates')
            ->assertForbidden();
    }

    public function test_the_preview_renders_the_draft_body(): void
    {
        $preview = $this->actingAs($this->user(Role::REVIEWING_OFFICER))
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
