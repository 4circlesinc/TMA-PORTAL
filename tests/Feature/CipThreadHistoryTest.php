<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * One history per application: every line on the file, whichever screen it
 * was written on, once.
 */
class CipThreadHistoryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Mail::fake();
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

    /** @return array{0: User, 1: User, 2: CipApplication} */
    private function filed(): array
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $client = Client::create([
            'uid' => 'chen-wei', 'name' => 'Chen Wei', 'email' => 'chen@example.com',
            'created_by' => $staff->id, 'data' => [],
        ]);
        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'general', 'status' => CompanyMember::STATUS_ACTIVE,
            'added_by' => $staff->id,
        ]);

        return [$staff, $contact, $application];
    }

    private function caseChat(CipApplication $application, User ...$members): Conversation
    {
        $conversation = Conversation::create([
            'type' => Conversation::TYPE_GROUP,
            'name' => 'Chen Wei',
            'created_by' => $members[0]->id,
            'client_id' => $application->client_id,
            'cip_application_id' => $application->id,
            'subject' => Conversation::SUBJECT_PROVIDER,
            'last_message_at' => now(),
        ]);

        foreach ($members as $member) {
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $member->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $conversation;
    }

    public function test_the_same_press_delivered_twice_files_one_note(): void
    {
        [$staff, , $application] = $this->filed();
        $url = '/portal/cip/applications/'.$application->uuid.'/messages';
        $press = ['body' => 'Passport scan received.', 'lane' => 'internal', 'clientKey' => (string) Str::uuid()];

        $first = $this->actingAs($staff)->postJson($url, $press)->assertCreated()->json('id');
        $again = $this->actingAs($staff)->postJson($url, $press)->assertOk()->json('id');

        $this->assertSame($first, $again);
        $this->assertSame(1, CipApplicationMessage::where('application_id', $application->id)->count());
    }

    public function test_identical_words_inside_a_few_seconds_are_one_message_without_a_key(): void
    {
        [$staff, , $application] = $this->filed();
        $url = '/portal/cip/applications/'.$application->uuid.'/messages';

        $this->actingAs($staff)->postJson($url, ['body' => 'Chasing the bank letter.', 'lane' => 'provider'])->assertCreated();
        $this->actingAs($staff)->postJson($url, ['body' => 'Chasing the bank letter.', 'lane' => 'provider'])->assertOk();
        $this->assertSame(1, CipApplicationMessage::where('application_id', $application->id)->count());

        // Later, the same words are a new message.
        $this->travel(30)->seconds();
        $this->actingAs($staff)->postJson($url, ['body' => 'Chasing the bank letter.', 'lane' => 'provider'])->assertCreated();
        $this->assertSame(2, CipApplicationMessage::where('application_id', $application->id)->count());
    }

    public function test_a_file_sent_in_the_case_chat_appears_on_the_applications_messages_tab(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $conversation = $this->caseChat($application, $staff, $contact);
        $attachment = MessageAttachment::create([
            'uuid' => (string) Str::uuid(),
            'conversation_id' => $conversation->id,
            'uploaded_by' => $staff->id,
            'disk' => 'local',
            'path' => 'messaging/bank-letter.pdf',
            'name' => 'bank-letter.pdf',
            'mime' => 'application/pdf',
            'extension' => 'pdf',
            'status' => MessageAttachment::STATUS_STAGED,
            'size' => 1200,
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$conversation->uuid.'/messages', [
                'body' => 'The letter, as promised.',
                'attachments' => [$attachment->uuid],
            ])
            ->assertSuccessful();

        $thread = $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->json('messages');

        $this->assertCount(1, $thread);
        $this->assertSame('The letter, as promised.', $thread[0]['body']);
        $this->assertSame('bank-letter.pdf', $thread[0]['attachments'][0]['name']);
        $this->assertStringContainsString('download=1', $thread[0]['attachments'][0]['downloadUrl']);

        // Linked, so opening the chat does not copy it back a second time.
        $this->assertSame(1, Message::where('conversation_id', $conversation->id)->where('type', '!=', Message::TYPE_SYSTEM)->count());
    }

    public function test_deleting_a_line_on_the_file_removes_it_from_the_case_chat(): void
    {
        [$staff, , $application] = $this->filed();
        $id = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', ['body' => 'Wrong file, sorry.', 'lane' => 'provider'])
            ->assertCreated()
            ->json('id');

        $row = CipApplicationMessage::where('uuid', $id)->firstOrFail();
        $copy = Message::where('cip_application_message_id', $row->id)->firstOrFail();

        $this->actingAs($staff)
            ->deleteJson('/portal/cip/applications/'.$application->uuid.'/messages/'.$id)
            ->assertOk();

        $this->assertNull(CipApplicationMessage::find($row->id));
        $this->assertSoftDeleted('messages', ['id' => $copy->id]);
    }

    public function test_only_the_author_or_an_administrator_may_delete(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $id = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', ['body' => 'For the provider.', 'lane' => 'provider'])
            ->assertCreated()
            ->json('id');

        $this->actingAs($contact)
            ->deleteJson('/portal/cip/applications/'.$application->uuid.'/messages/'.$id)
            ->assertForbidden();

        $this->assertSame(1, CipApplicationMessage::where('uuid', $id)->count());

        $listed = $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->json('messages.0');
        $this->assertFalse($listed['canDelete']);
    }

    public function test_deleting_the_chat_copy_takes_the_files_line_with_it(): void
    {
        [$staff, , $application] = $this->filed();
        $id = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', ['body' => 'Sent twice by mistake.', 'lane' => 'provider'])
            ->assertCreated()
            ->json('id');
        $row = CipApplicationMessage::where('uuid', $id)->firstOrFail();
        $copy = Message::where('cip_application_message_id', $row->id)->firstOrFail();

        $this->actingAs($staff)
            ->deleteJson('/portal/messaging/messages/'.$copy->uuid)
            ->assertOk();

        $this->assertNull(CipApplicationMessage::find($row->id));
    }

    /**
     * A chat copy deleted in Messages before the file's line went with it
     * (older data) must not stop the case chat from opening: the copy step
     * used to look past the deleted row, try to write a second copy of the
     * same line, and hit the unique link — a server error on "Message …
     * about …" for that application from then on.
     */
    public function test_a_copy_deleted_in_the_chat_does_not_stop_the_case_chat_opening(): void
    {
        [$staff, , $application] = $this->filed();
        $id = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', ['body' => 'Older line.', 'lane' => 'provider'])
            ->assertCreated()
            ->json('id');
        $row = CipApplicationMessage::where('uuid', $id)->firstOrFail();

        // As the chat's own delete used to leave things: the copy gone, the
        // file's line still there.
        Message::where('cip_application_message_id', $row->id)->firstOrFail()->delete();

        $client = $application->client;
        $this->actingAs($staff)
            ->postJson('/portal/clients/'.$client->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated();

        // The deleted copy stays deleted; no second copy of the line appears.
        $this->assertSame(1, Message::withTrashed()->where('cip_application_message_id', $row->id)->count());
    }
}
