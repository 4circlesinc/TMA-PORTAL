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

    public function test_opening_a_client_chat_does_not_put_it_in_the_inbox(): void
    {
        $fx = $this->applicantWithProvider();

        $id = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        $this->actingAs($fx['staff'])
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonMissing(['id' => $id]);

        $this->actingAs($fx['providerUser'])
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonMissing(['id' => $id]);

        $this->actingAs($fx['staff'])
            ->postJson('/portal/messaging/conversations/'.$id.'/messages', ['body' => 'Please send the passport scan.'])
            ->assertOk();

        $this->actingAs($fx['staff'])
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $id,
                'name' => 'Ahmed Hassan',
                'subtitle' => 'Galaxy Partners',
            ]);

        $this->actingAs($fx['providerUser'])
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonFragment(['id' => $id]);
    }

    public function test_opening_a_private_dm_does_not_put_it_in_the_applicants_inbox(): void
    {
        $login = $this->portalUser();
        $fx = $this->applicantWithProvider($login);

        $opened = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'person'])
            ->assertCreated()
            ->json('conversation');

        $this->assertFalse($opened['listed']);

        $this->actingAs($login)
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonMissing(['id' => $opened['id']]);

        $this->actingAs($fx['staff'])
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonMissing(['id' => $opened['id']]);

        $this->actingAs($fx['staff'])
            ->postJson('/portal/messaging/conversations/'.$opened['id'].'/messages', ['body' => 'Hello Ahmed'])
            ->assertOk();

        $this->actingAs($login)
            ->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonFragment(['id' => $opened['id']]);
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
        $this->assertFalse($ids->contains($id));
    }

    public function test_the_provider_side_opens_the_same_case_thread_as_staff(): void
    {
        $fx = $this->applicantWithProvider();

        // The firm opens it first; the provider must join that thread rather
        // than start a second one about the same file.
        $staffThread = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        $providerThread = $this->actingAs($fx['providerUser'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        $this->assertSame($staffThread, $providerThread);
        $this->assertSame(1, Conversation::where('client_id', $fx['client']->id)
            ->where('subject', Conversation::SUBJECT_PROVIDER)
            ->count());
    }

    public function test_a_thread_the_provider_opens_first_still_has_the_firm_in_it(): void
    {
        $fx = $this->applicantWithProvider();

        $id = $this->actingAs($fx['providerUser'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        $conversation = Conversation::where('uuid', $id)->firstOrFail();
        $memberIds = $conversation->activeParticipants()->pluck('user_id')->all();

        // Otherwise they are writing to an empty room.
        $this->assertContains($fx['providerUser']->id, $memberIds);
        $this->assertContains($fx['staff']->id, $memberIds);
        $this->assertSame('group', $conversation->type);
        $this->assertSame('Ahmed Hassan', $conversation->name);
    }

    public function test_the_provider_side_is_not_told_to_message_itself(): void
    {
        $fx = $this->applicantWithProvider($this->portalUser());

        $options = $this->actingAs($fx['providerUser'])
            ->getJson('/portal/clients/'.$fx['client']->uid.'/conversations')
            ->assertOk()
            ->json('options');

        $this->assertTrue($options['provider']['available']);
        $this->assertTrue($options['provider']['viewerIsProvider']);
        // The private DM with the applicant is the firm's to start.
        $this->assertFalse($options['person']['available']);
    }

    public function test_a_contact_at_another_firm_cannot_open_this_applicants_thread(): void
    {
        $fx = $this->applicantWithProvider();

        $otherCompany = Company::create(['uid' => 'rival', 'name' => 'Rival Advisors']);
        CipProvider::create([
            'name' => 'Rival Advisors',
            'code' => 'RIV',
            'company_id' => $otherCompany->id,
        ]);
        $outsider = $this->portalUser();
        CompanyMember::create([
            'company_id' => $otherCompany->id,
            'user_id' => $outsider->id,
            'name' => $outsider->name,
            'email' => $outsider->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        // 404, not 403: another firm's applicant does not exist to them.
        $this->actingAs($outsider)
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertNotFound();

        $this->assertSame(0, Conversation::where('client_id', $fx['client']->id)->count());
    }

    public function test_the_provider_side_cannot_open_a_private_dm_with_the_applicant(): void
    {
        $login = $this->portalUser();
        $fx = $this->applicantWithProvider($login);

        $this->actingAs($fx['providerUser'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'person'])
            ->assertForbidden();
    }

    public function test_a_case_thread_shows_the_applicant_and_the_provider_only(): void
    {
        $fx = $this->applicantWithProvider();
        // The photo the application carries — what the disc should lead with.
        Client::whereKey($fx['client']->id)->update(['photo_url' => '/media/avatars/amy.jpg']);

        $id = $this->actingAs($fx['staff'])
            ->postJson('/portal/clients/'.$fx['client']->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        // Another administrator in the room: reachable, but not what the
        // thread is about, so not a face on it.
        $otherStaff = $this->staff();
        $conversation = Conversation::where('uuid', $id)->firstOrFail();
        $conversation->participants()->create([
            'user_id' => $otherStaff->id,
            'role' => ConversationParticipant::ROLE_ADMIN,
            'joined_at' => now(),
        ]);

        // A case thread reaches the inbox once somebody actually writes.
        $conversation->messages()->create([
            'user_id' => $fx['staff']->id,
            'type' => Message::TYPE_TEXT,
            'body' => 'Opening the file.',
        ]);
        $conversation->forceFill(['last_message_at' => now()])->save();

        foreach ([$fx['staff'], $fx['providerUser']] as $viewer) {
            $row = collect($this->actingAs($viewer)
                ->getJson('/portal/messaging/conversations')
                ->json('conversations'))
                ->firstWhere('id', $id);

            $names = collect($row['members'])->pluck('name')->all();
            $this->assertSame(
                ['Ahmed Hassan', $fx['providerUser']->name],
                $names,
                'A case thread shows the applicant and the firm, whoever is reading it.'
            );
            $this->assertSame('/media/avatars/amy.jpg', $row['members'][0]['photo']);
        }
    }
}
