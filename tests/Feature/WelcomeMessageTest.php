<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Conversation;
use App\Models\Invitation;
use App\Models\Message;
use App\Models\Notification;
use App\Models\Template;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Invitations\Invitations;
use App\Support\Messaging\WelcomeMessage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Templates > Welcome Message: the direct message a new person finds in their
 * Messages inbox, from the administrator chosen to send it, once, whichever
 * way their account first became active.
 */
class WelcomeMessageTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type, array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $o));
    }

    private function pending(array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'pending',
            'account_type' => Role::CLIENT,
            'first_name' => 'Dana',
            'last_name' => 'Reed',
            'name' => 'Dana Reed',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $o));
    }

    private function switchOn(User $admin, User $sender, string $body = 'Hi {{firstName}}, I am {{senderName}}{{#senderTitle}}, {{senderTitle}}{{/senderTitle}}.'): void
    {
        $this->actingAs($admin)->patchJson('/portal/templates/welcome-message', [
            'enabled' => true,
            'senderId' => $sender->id,
            'body' => $body,
        ])->assertOk()->assertJsonPath('enabled', true);
    }

    private function approve(User $admin, User $user): void
    {
        $this->actingAs($admin)
            ->postJson("/admin/users/{$user->id}/approve", ['account_type' => Role::REVIEWING_OFFICER])
            ->assertOk();
    }

    /** Messages someone else wrote in a conversation this person is in. */
    private function welcomes(User $to): Collection
    {
        return Message::query()
            ->whereHas('conversation.participants', fn ($q) => $q->where('user_id', $to->id))
            ->where('user_id', '!=', $to->id)
            ->get();
    }

    public function test_it_is_off_until_an_administrator_switches_it_on(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $newbie = $this->pending();

        $this->approve($admin, $newbie);

        $this->assertCount(0, $this->welcomes($newbie));
        $this->assertNotNull($newbie->fresh()->welcomed_at);

        $this->actingAs($admin)->getJson('/portal/templates/welcome-message')
            ->assertOk()
            ->assertJsonPath('enabled', false)
            ->assertJsonPath('senderId', null)
            ->assertJsonPath('body', WelcomeMessage::DEFAULT_BODY);
    }

    public function test_approval_posts_it_from_the_chosen_administrator_into_both_inboxes(): void
    {
        $approver = $this->user(Role::ADMINISTRATOR);
        $sender = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis', 'job_title' => 'IT and Web Solutions Specialist']);
        $this->switchOn($approver, $sender);
        $newbie = $this->pending();

        $this->approve($approver, $newbie);

        $welcomes = $this->welcomes($newbie);
        $this->assertCount(1, $welcomes);
        $message = $welcomes->first();
        $this->assertSame($sender->id, $message->user_id);
        $this->assertSame(Message::TYPE_TEXT, $message->type);
        $this->assertSame('Hi Dana, I am Vernon Francis, IT and Web Solutions Specialist.', $message->body);

        $conversation = $message->conversation;
        $this->assertSame(Conversation::TYPE_DIRECT, $conversation->type);
        $this->assertEqualsCanonicalizing(
            [$sender->id, $newbie->id],
            $conversation->participants()->pluck('user_id')->all(),
        );

        // It lists in the new person's inbox, unread, and in the sender's.
        $row = collect($this->actingAs($newbie->fresh())->getJson('/portal/messaging/conversations')->assertOk()->json('conversations'))
            ->firstWhere('id', $conversation->uuid);
        $this->assertNotNull($row, 'the welcome should list in the new person’s inbox');
        $this->assertSame(1, $row['unread']);

        $senderRow = collect($this->actingAs($sender)->getJson('/portal/messaging/conversations')->assertOk()->json('conversations'))
            ->firstWhere('id', $conversation->uuid);
        $this->assertNotNull($senderRow, 'the welcome should list in the sender’s inbox');
        $this->assertSame(0, $senderRow['unread']);

        // The bell has it.
        $this->assertSame(1, Notification::where('user_id', $newbie->id)->where('type', 'message.received')->count());
    }

    public function test_the_message_rings_the_bell_without_a_second_email(): void
    {
        Mail::fake();
        $approver = $this->user(Role::ADMINISTRATOR);
        $sender = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis']);
        $this->switchOn($approver, $sender);
        $newbie = $this->pending();

        $this->approve($approver, $newbie);

        $this->assertCount(1, $this->welcomes($newbie));
        // The approval postcard is the only mail: no "new message" one behind it.
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo($newbie->email));
        Mail::assertSent(Postcard::class, fn (Postcard $mail) => $mail->hasTo($newbie->email));
    }

    public function test_an_accepted_invitation_is_welcomed(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis']);
        $this->switchOn($admin, $admin);

        [$invitation] = Invitations::issue([
            'type' => Invitation::TYPE_STAFF,
            'email' => 'officer@tma.test',
            'role' => Role::REVIEWING_OFFICER,
            'invited_by' => $admin->id,
        ]);
        $officer = Invitations::acceptAsNewUser($invitation, 'sup3rsecret!', ['first_name' => 'Sam', 'last_name' => 'Ito']);

        $welcomes = $this->welcomes($officer);
        $this->assertCount(1, $welcomes);
        $this->assertSame('Hi Sam, I am Vernon Francis.', $welcomes->first()->body);
    }

    public function test_nobody_is_welcomed_twice(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->switchOn($admin, $admin);
        $newbie = $this->pending();

        $this->approve($admin, $newbie);
        // A second Approve finds the account already approved.
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/approve", ['account_type' => Role::REVIEWING_OFFICER]);
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/suspend")->assertOk();
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/reactivate")->assertOk();

        $this->assertSame('approved', $newbie->fresh()->status);
        $this->assertCount(1, $this->welcomes($newbie));
    }

    public function test_people_who_joined_while_it_was_off_are_not_welcomed_later(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $newbie = $this->pending();
        $this->approve($admin, $newbie);

        $this->switchOn($admin, $admin);
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/suspend")->assertOk();
        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/reactivate")->assertOk();

        $this->assertCount(0, $this->welcomes($newbie));
    }

    public function test_a_denied_account_that_is_later_let_in_is_welcomed_then(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->switchOn($admin, $admin);
        $newbie = $this->pending();

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/deny", ['reason' => 'Not yet'])->assertOk();
        $this->assertCount(0, $this->welcomes($newbie));

        $this->actingAs($admin)->postJson("/admin/users/{$newbie->id}/reactivate")->assertOk();

        $this->assertCount(1, $this->welcomes($newbie));
    }

    public function test_a_sender_who_can_no_longer_send_it_sends_nothing_and_the_approval_stands(): void
    {
        $approver = $this->user(Role::ADMINISTRATOR);
        $sender = $this->user(Role::ADMINISTRATOR);
        $this->switchOn($approver, $sender);
        $sender->forceFill(['status' => 'suspended'])->save();
        $newbie = $this->pending();

        $this->approve($approver, $newbie);

        $this->assertSame('approved', $newbie->fresh()->status);
        $this->assertCount(0, $this->welcomes($newbie));
    }

    public function test_saving_checks_the_placeholders_and_the_sender(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($admin)->patchJson('/portal/templates/welcome-message', [
            'enabled' => true, 'senderId' => $admin->id, 'body' => 'Hi {{nickname}}',
        ])->assertUnprocessable()->assertJsonValidationErrors('body');

        $this->actingAs($admin)->patchJson('/portal/templates/welcome-message', [
            'enabled' => true, 'senderId' => null, 'body' => 'Welcome!',
        ])->assertUnprocessable()->assertJsonValidationErrors('senderId');

        // Only an administrator may be the sender.
        $this->actingAs($admin)->patchJson('/portal/templates/welcome-message', [
            'enabled' => true, 'senderId' => $officer->id, 'body' => 'Welcome!',
        ])->assertUnprocessable()->assertJsonValidationErrors('senderId');

        $this->actingAs($admin)->patchJson('/portal/templates/welcome-message', [
            'enabled' => false, 'senderId' => null, 'body' => '   ',
        ])->assertUnprocessable()->assertJsonValidationErrors('body');

        $this->assertSame(0, Template::where('kind', WelcomeMessage::KIND)->count());

        // Off, with a draft and nobody chosen yet, saves.
        $this->actingAs($admin)->patchJson('/portal/templates/welcome-message', [
            'enabled' => false, 'senderId' => null, 'body' => 'Welcome, {{firstName}}!',
        ])->assertOk()
            ->assertJsonPath('enabled', false)
            ->assertJsonPath('body', 'Welcome, {{firstName}}!')
            ->assertJsonPath('senders.0.id', $admin->id);
    }

    public function test_the_shipped_wording_keeps_a_name_and_drops_a_missing_title(): void
    {
        $sender = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis', 'job_title' => null]);
        $recipient = $this->pending();

        $text = WelcomeMessage::render(WelcomeMessage::DEFAULT_BODY, $recipient, $sender);

        $this->assertStringStartsWith("Hi Dana,\n\nWelcome to the TM Antoine Advisory Portal! I'm Vernon Francis at TM Antoine Partners.", $text);
        $this->assertStringNotContainsString('{{', $text);

        $sender->job_title = 'IT and Web Solutions Specialist';
        $withTitle = WelcomeMessage::render(WelcomeMessage::DEFAULT_BODY, $recipient, $sender);
        $this->assertStringContainsString("I'm Vernon Francis, IT and Web Solutions Specialist at TM Antoine Partners.", $withTitle);
    }

    public function test_the_preview_fills_the_placeholders(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis', 'job_title' => 'IT Specialist']);

        $this->actingAs($admin)->postJson('/portal/templates/welcome-message/preview', [
            'body' => 'Hi {{firstName}} ({{name}}), I am {{senderName}}{{#senderTitle}}, {{senderTitle}}{{/senderTitle}}.',
            'senderId' => $admin->id,
        ])->assertOk()->assertJsonPath('text', 'Hi Ada (Ada Lovelace), I am Vernon Francis, IT Specialist.');
    }

    public function test_only_administrators_reach_it(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $client = $this->user(Role::CLIENT);

        foreach ([$officer, $client] as $user) {
            $this->actingAs($user)->getJson('/portal/templates/welcome-message')->assertForbidden();
            $this->actingAs($user)->patchJson('/portal/templates/welcome-message', [
                'enabled' => true, 'senderId' => $user->id, 'body' => 'Hello',
            ])->assertForbidden();
        }

        $this->assertSame(0, Template::where('kind', WelcomeMessage::KIND)->count());
    }
}
