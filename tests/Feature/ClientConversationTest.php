<?php

namespace Tests\Feature;

use App\Models\CallRecording;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Messaging from an applicant: the provider case thread, the private DM
 * when they have a login, the profile record, and call recording against
 * the applicant rather than the provider contact.
 */
class ClientConversationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function staff(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function portalUser(string $accountType = 'Client'): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @return array{staff: User, client: Client, company: Company, providerUser: User} */
    private function applicantWithProvider(?User $applicantLogin = null): array
    {
        $staff = $this->staff();
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $provider = CipProvider::create([
            'name' => 'Galaxy Partners',
            'code' => 'GAL',
            'company_id' => $company->id,
        ]);
        $providerUser = $this->portalUser();
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $providerUser->id,
            'name' => $providerUser->name,
            'email' => $providerUser->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $client = Client::create([
            'uid' => 'ahmed-hassan',
            'name' => 'Ahmed Hassan',
            'user_id' => $applicantLogin?->id,
            'email' => 'ahmed@example.com',
            'data' => [],
        ]);
        Applications::create($provider, $staff, ['client_id' => $client->id]);

        return compact('staff', 'client', 'company', 'providerUser');
    }

    public function test_the_message_options_offer_the_provider_and_the_person_when_they_have_a_login(): void
    {
        $login = $this->portalUser();
        $fx = $this->applicantWithProvider($login);

        $body = $this->actingAs($fx['staff'])
            ->getJson('/portal/clients/'.$fx['client']->uid.'/conversations')
            ->assertOk()
            ->json();

        $this->assertTrue($body['options']['provider']['available']);
        $this->assertSame('Galaxy Partners', $body['options']['provider']['companyName']);
        $this->assertTrue($body['options']['person']['available']);
        $this->assertSame('Ahmed Hassan', $body['options']['person']['name']);
    }

    public function test_private_messaging_is_not_offered_without_a_portal_login(): void
    {
        $fx = $this->applicantWithProvider();

        $this->actingAs($fx['staff'])
            ->getJson('/portal/clients/'.$fx['client']->uid.'/conversations')
            ->assertOk()
            ->assertJsonPath('options.person.available', false);
    }

    public function test_messaging_the_provider_opens_a_case_thread_named_for_the_applicant(): void
    {
        $fx = $this->applicantWithProvider();

        $body = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation');

        $this->assertSame('group', $body['type']);
        $this->assertSame('Ahmed Hassan', $body['name']);
        $this->assertSame('Galaxy Partners', $body['subtitle']);
        $this->assertSame('provider', $body['subject']);
        $this->assertSame('ahmed-hassan', $body['about']['clientUid']);

        $conversation = Conversation::where('uuid', $body['id'])->firstOrFail();
        $memberIds = $conversation->activeParticipants()->pluck('user_id')->all();
        $this->assertContains($fx['staff']->id, $memberIds);
        $this->assertContains($fx['providerUser']->id, $memberIds);
        $this->assertNotContains($fx['client']->user_id, $memberIds);
    }

    public function test_opening_the_provider_thread_twice_reuses_the_same_conversation(): void
    {
        $fx = $this->applicantWithProvider();

        $first = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->json('conversation.id');
        $second = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->json('conversation.id');

        $this->assertSame($first, $second);
        $this->assertSame(1, Conversation::where('client_id', $fx['client']->id)->where('subject', 'provider')->count());
    }

    public function test_another_officer_joins_the_existing_provider_thread(): void
    {
        $fx = $this->applicantWithProvider();
        $other = $this->staff(['email' => 'other@example.com']);

        $id = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->json('conversation.id');

        $joined = $this->actingAs($other)
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        $this->assertSame($id, $joined);
        $conversation = Conversation::where('uuid', $id)->firstOrFail();
        $this->assertTrue(
            $conversation->activeParticipants()->where('user_id', $other->id)->exists()
        );
    }

    public function test_messaging_the_person_privately_requires_a_login_and_tags_the_thread(): void
    {
        $fx = $this->applicantWithProvider();

        $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'person'])
            ->assertStatus(422);

        $login = $this->portalUser();
        $fx['client']->forceFill(['user_id' => $login->id])->save();

        $body = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'person'])
            ->assertCreated()
            ->json('conversation');

        $this->assertSame('direct', $body['type']);
        $this->assertSame('Private', $body['subtitle']);
        $this->assertSame('person', $body['subject']);
        $this->assertSame($login->name, $body['name']);
    }

    public function test_the_profile_lists_the_provider_thread_and_recordings_for_the_applicant(): void
    {
        $fx = $this->applicantWithProvider();

        $conversation = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->json('conversation');

        CallRecording::create([
            'uuid' => '11111111-1111-1111-1111-111111111111',
            'conversation_id' => Conversation::where('uuid', $conversation['id'])->value('id'),
            'client_id' => $fx['client']->id,
            'recorded_by' => $fx['staff']->id,
            'participants' => [
                ['id' => $fx['staff']->id, 'name' => $fx['staff']->name, 'accountType' => 'Administrator'],
            ],
            'client_name' => $fx['client']->name,
            'media' => 'audio',
            'status' => CallRecording::STATUS_READY,
            'started_at' => now(),
        ]);

        $body = $this->actingAs($fx['staff'])
            ->getJson('/portal/clients/'.$fx['client']->uid.'/conversations')
            ->assertOk()
            ->json();

        $this->assertSame($conversation['id'], $body['conversations'][0]['id']);
        $this->assertCount(1, $body['recordings']);
        $this->assertSame('Ahmed Hassan', $body['recordings'][0]['clientName']);
    }

    public function test_a_call_on_the_provider_thread_is_recorded_against_the_applicant(): void
    {
        $fx = $this->applicantWithProvider();

        $id = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->json('conversation.id');

        $this->actingAs($fx['staff'])
            ->postJson('/portal/messaging/conversations/'.$id.'/recordings', ['media' => 'audio'])
            ->assertCreated();

        $this->assertDatabaseHas('call_recordings', [
            'client_id' => $fx['client']->id,
            'client_name' => 'Ahmed Hassan',
            'recorded_by' => $fx['staff']->id,
            'status' => 'recording',
        ]);
    }

    public function test_the_inbox_shows_the_applicant_and_the_provider(): void
    {
        $fx = $this->applicantWithProvider();

        $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider']);

        $this->actingAs($fx['staff'])
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonFragment([
                'name' => 'Ahmed Hassan',
                'subtitle' => 'Galaxy Partners',
            ]);
    }

    public function test_a_client_account_cannot_open_the_hub_conversation_endpoints(): void
    {
        $fx = $this->applicantWithProvider();
        $outsider = $this->portalUser();

        $this->actingAs($outsider)
            ->getJson('/portal/clients/'.$fx['client']->uid.'/conversations')
            ->assertForbidden();
    }

    public function test_purging_a_login_and_inviting_again_keeps_the_person_thread_and_recordings(): void
    {
        $login = $this->portalUser();
        $fx = $this->applicantWithProvider($login);

        $id = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'person'])
            ->json('conversation.id');

        $conversation = Conversation::where('uuid', $id)->firstOrFail();
        Message::create([
            'conversation_id' => $conversation->id,
            'user_id' => $fx['staff']->id,
            'type' => Message::TYPE_TEXT,
            'body' => 'Please send the passport scan.',
        ]);
        CallRecording::create([
            'uuid' => '22222222-2222-2222-2222-222222222222',
            'conversation_id' => $conversation->id,
            'client_id' => $fx['client']->id,
            'client_user_id' => $login->id,
            'recorded_by' => $fx['staff']->id,
            'participants' => [],
            'client_name' => $fx['client']->name,
            'media' => 'audio',
            'status' => CallRecording::STATUS_READY,
            'started_at' => now(),
        ]);

        $this->actingAs($fx['staff'])->deleteJson('/admin/users/'.$login->id)->assertOk();
        $this->actingAs($fx['staff'])->deleteJson('/portal/admin/recycle-bin/user/'.$login->id)->assertOk();

        $this->assertSame($id, $conversation->fresh()->uuid);
        $this->assertFalse(
            ConversationParticipant::query()
                ->where('conversation_id', $conversation->id)
                ->where('user_id', $login->id)
                ->exists()
        );

        $again = $this->portalUser();
        $fx['client']->refresh()->forceFill(['user_id' => $again->id])->save();

        $reused = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'person'])
            ->assertCreated()
            ->json('conversation.id');

        $this->assertSame($id, $reused);
        $this->assertTrue(
            ConversationParticipant::query()
                ->where('conversation_id', $conversation->id)
                ->where('user_id', $again->id)
                ->whereNull('left_at')
                ->exists()
        );

        $this->actingAs($again)->getJson('/portal/messaging/conversations')->assertOk();
        $ids = collect($this->actingAs($again)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->pluck('id');
        $this->assertTrue($ids->contains($id));

        $bodies = collect(
            $this->actingAs($again)->getJson('/portal/messaging/conversations/'.$id.'/messages')->json('messages')
        )->pluck('body');
        $this->assertTrue($bodies->contains('Please send the passport scan.'));

        $this->assertSame($again->id, CallRecording::first()->client_user_id);
        $this->actingAs($fx['staff'])
            ->getJson('/portal/clients/'.$fx['client']->uid.'/conversations')
            ->assertOk()
            ->assertJsonPath('recordings.0.clientName', 'Ahmed Hassan');
    }

    public function test_a_new_provider_contact_joins_the_existing_case_thread(): void
    {
        $fx = $this->applicantWithProvider();

        $id = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->json('conversation.id');

        $colleague = $this->portalUser();
        CompanyMember::create([
            'company_id' => $fx['company']->id,
            'user_id' => $colleague->id,
            'name' => $colleague->name,
            'email' => $colleague->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $this->actingAs($colleague)->getJson('/portal/messaging/conversations')->assertOk();

        $conversation = Conversation::where('uuid', $id)->firstOrFail();
        $this->assertTrue(
            $conversation->activeParticipants()->where('user_id', $colleague->id)->exists()
        );

        $ids = collect($this->actingAs($colleague)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->pluck('id');
        $this->assertTrue($ids->contains($id));
    }
}
