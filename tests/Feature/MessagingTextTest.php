<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Notification;
use App\Models\User;
use App\Support\Messaging\MessageText;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A message's text where only one plain line of it is shown.
 *
 * In its bubble a message keeps its lines and draws *bold* and _italic_. A
 * chat list row, a reply quote and a notification show one plain line, where
 * the marks would only be stray asterisks: they are read out without them.
 */
class MessagingTextTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $name, string $email): User
    {
        return User::factory()->create([
            'name' => $name,
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_the_marks_are_taken_out_and_nothing_else_is(): void
    {
        $cases = [
            '*bold* and _italic_ and **also bold**' => 'bold and italic and also bold',
            '__bold__ too' => 'bold too',
            '*bold _with italic_ inside*' => 'bold with italic inside',
            '(*in brackets*) "_quoted_"' => '(in brackets) "quoted"',
            '*Important:* read this.' => 'Important: read this.',
            // Arithmetic, an identifier, a correction and an address are not emphasis.
            '2*3*4 and 5 * 6 * 7' => '2*3*4 and 5 * 6 * 7',
            'snake_case_name' => 'snake_case_name',
            '*their' => '*their',
            'see https://example.com/a_b_c/_x_/?q=*a* ok' => 'see https://example.com/a_b_c/_x_/?q=*a* ok',
            '****' => '****',
            // And a preview is one line.
            "first line\nsecond line\n\n* a point" => 'first line second line * a point',
        ];

        foreach ($cases as $typed => $read) {
            $this->assertSame($read, MessageText::plain($typed), $typed);
        }

        $this->assertSame('', MessageText::plain(null));
    }

    public function test_a_row_a_quote_and_a_notification_read_without_the_marks_and_the_message_keeps_them(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');

        $c = Conversation::create([
            'type' => Conversation::TYPE_GROUP, 'name' => 'Tax team',
            'created_by' => $ada->id, 'last_message_at' => now(),
        ]);
        foreach ([$ada, $rita] as $u) {
            ConversationParticipant::create([
                'conversation_id' => $c->id, 'user_id' => $u->id,
                'role' => ConversationParticipant::ROLE_MEMBER, 'joined_at' => now(),
            ]);
        }

        $typed = "*Important:* the office is _closed_ on Friday\nPlease plan around it";

        $sent = $this->actingAs($ada)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => $typed])
            ->assertOk()
            ->json('message');

        // The message is stored and handed out exactly as it was typed.
        $this->assertSame($typed, $sent['body']);

        $row = collect($this->actingAs($rita)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->firstWhere('id', $c->uuid);
        $this->assertSame('Ada Lovelace: Important: the office is closed on Friday Please plan around it', $row['preview']);

        $this->assertStringContainsString(
            'Important: the office is closed on Friday Please plan around it',
            Notification::query()->where('user_id', $rita->id)->sole()->message,
        );

        $reply = $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Noted.', 'replyTo' => $sent['id']])
            ->assertOk()
            ->json('message');
        $this->assertSame('Important: the office is closed on Friday Please plan around it', $reply['replyTo']['preview']);
    }
}
