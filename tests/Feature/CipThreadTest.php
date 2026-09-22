<?php

namespace Tests\Feature;

use App\Events\CipThreadChanged;
use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Section 24 — the application messaging centre.
 *
 * A thread on the file, not a chat conversation. Internal notes never leave
 * staff. A provider message is one postcard per other-side mailbox, and the
 * realtime event names the file without carrying the body.
 */
class CipThreadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    /**
     * An application the provider contact can reach, with a client row so
     * the table envelope has somewhere to hang an unread count.
     *
     * @return array{0: User, 1: User, 2: CipApplication}
     */
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

    private function attention(User $viewer, CipApplication $application): ?array
    {
        $row = collect(
            $this->actingAs($viewer)->getJson('/portal/cip/applications')->assertOk()->json('applications')
        )->firstWhere('id', $application->uuid);

        return $row['attention'] ?? null;
    }

    public function test_staff_internal_notes_never_leave_the_server_in_a_provider_payload(): void
    {
        [$staff, $contact, $application] = $this->filed();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Hold this until the scan arrives.',
                'lane' => 'internal',
            ])->assertCreated()->assertJsonPath('lane', 'internal');

        $staffThread = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->assertJsonPath('canPostInternal', true)
            ->json('messages');

        $this->assertSame(['Hold this until the scan arrives.'], array_column($staffThread, 'body'));
        $this->assertSame(['internal'], array_column($staffThread, 'lane'));

        $providerThread = $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->assertJsonPath('canPostInternal', false)
            ->json('messages');

        $this->assertSame([], $providerThread);
        $this->assertNull($this->attention($contact, $application));
    }

    public function test_a_provider_message_is_visible_to_the_firm(): void
    {
        [$staff, $contact, $application] = $this->filed();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Please send the original.',
                'lane' => 'provider',
            ])->assertCreated();

        $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->assertJsonPath('messages.0.body', 'Please send the original.')
            ->assertJsonPath('messages.0.lane', 'provider');
    }

    public function test_the_provider_side_cannot_post_an_internal_note(): void
    {
        [, $contact, $application] = $this->filed();

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Trying to write a staff note.',
                'lane' => 'internal',
            ])->assertStatus(422);

        $this->assertDatabaseCount('cip_application_messages', 0);
    }

    public function test_an_officer_who_does_not_hold_the_file_can_still_read_the_thread(): void
    {
        [, , $application] = $this->filed();
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');

        $this->actingAs($officer)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk();

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Covering while Ada is out.',
            ])->assertCreated();
    }

    public function test_a_provider_message_sends_exactly_one_postcard_per_other_mailbox(): void
    {
        Mail::fake();

        [$staff, $contact, $application] = $this->filed();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Please send the original.',
                'lane' => 'provider',
            ])->assertCreated();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('gil@galaxy.example')
                && str_contains($mail->subjectLine, 'new message')
                && str_contains(json_encode($mail->payload), 'Please send the original.');
        });
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada@example.com'));
        Mail::assertQueuedCount(1);

        $this->assertDatabaseHas('email_deliveries', [
            'recipient' => 'gil@galaxy.example',
            'template' => 'cip-message',
            'related_id' => $application->id,
            'related_type' => CipApplication::class,
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.message',
        ]);
        $this->assertDatabaseMissing('portal_notifications', [
            'user_id' => $staff->id, 'type' => 'cip.message',
        ]);
    }

    public function test_an_internal_note_does_not_mail_the_provider(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        Assignments::assign($application, $officer, $staff);

        Mail::fake();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Hold this until the scan arrives.',
                'lane' => 'internal',
            ])->assertCreated();

        Mail::assertNothingQueued();
        $this->assertDatabaseMissing('email_deliveries', ['template' => 'cip-message']);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $officer->id, 'type' => 'cip.message',
        ]);
        $this->assertDatabaseMissing('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.message',
        ]);
    }

    public function test_the_realtime_signal_names_the_file_and_not_the_body(): void
    {
        Event::fake([CipThreadChanged::class]);

        [$staff, , $application] = $this->filed();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'A secret that must not ride the socket.',
                'lane' => 'internal',
            ])->assertCreated();

        Event::assertDispatched(CipThreadChanged::class, function (CipThreadChanged $event) use ($application) {
            $payload = $event->broadcastWith();

            return $event->application->is($application)
                && $event->action === 'created'
                && $payload === [
                    'applicationId' => $application->uuid,
                    'action' => 'created',
                ]
                && ! array_key_exists('body', $payload)
                && ! array_key_exists('lane', $payload);
        });
    }

    public function test_opening_the_thread_clears_the_envelope_and_peeking_does_not(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $bo = $this->user(Role::ADMINISTRATOR, 'bo@example.com', 'Bo Colleague');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Please send the original.',
                'lane' => 'provider',
            ])->assertCreated();

        $this->assertSame(1, $this->attention($bo, $application)['messages']);
        $this->assertSame(1, $this->attention($contact, $application)['messages']);
        $this->assertNull($this->attention($staff, $application), 'the author has already read their own line');

        $this->actingAs($bo)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages?peek=1')
            ->assertOk();
        $this->assertSame(1, $this->attention($bo, $application)['messages']);

        $this->actingAs($bo)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk();
        $this->assertNull($this->attention($bo, $application));

        $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk();
        $this->assertNull($this->attention($contact, $application));
    }

    public function test_an_internal_note_does_not_count_as_unread_for_the_provider(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $bo = $this->user(Role::ADMINISTRATOR, 'bo@example.com', 'Bo Colleague');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Hold this until the scan arrives.',
                'lane' => 'internal',
            ])->assertCreated();

        $this->assertSame(1, $this->attention($bo, $application)['messages']);
        $this->assertNull($this->attention($contact, $application));
    }

    public function test_a_stranger_is_not_told_the_thread_exists(): void
    {
        [$staff, , $application] = $this->filed();
        $stranger = $this->user(Role::CLIENT, 'nobody@example.com');

        $this->actingAs($stranger)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertNotFound();

        $this->actingAs($stranger)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'hello',
            ])->assertNotFound();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => '   ',
            ])->assertStatus(422);
    }

    public function test_a_reply_quotes_the_message_it_answers(): void
    {
        [$staff, $contact, $application] = $this->filed();

        $original = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'The scan is attached.',
                'lane' => 'provider',
            ])->assertCreated()->json();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Received, thank you.',
                'lane' => 'provider',
                'replyTo' => $original['id'],
            ])->assertCreated()
            ->assertJsonPath('replyTo.id', $original['id'])
            ->assertJsonPath('replyTo.senderName', 'Gil Contact')
            ->assertJsonPath('replyTo.preview', 'The scan is attached.');

        $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->assertJsonPath('messages.1.replyTo.preview', 'The scan is attached.');
    }

    public function test_an_internal_note_cannot_be_quoted_to_the_service_provider(): void
    {
        [$staff, $contact, $application] = $this->filed();

        $note = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Do not send this wording.',
                'lane' => 'internal',
            ])->assertCreated()->json();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Please send the original.',
                'lane' => 'provider',
                'replyTo' => $note['id'],
            ])->assertStatus(422);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Guessing at a staff note.',
                'lane' => 'provider',
                'replyTo' => $note['id'],
            ])->assertStatus(422);

        $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->assertJsonPath('messages', []);
    }

    public function test_the_module_being_dark_hides_the_thread(): void
    {
        [$staff, , $application] = $this->filed();
        config(['services.cip.enabled' => false]);

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertNotFound();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'hello',
            ])->assertNotFound();
    }

    public function test_sharing_an_internal_note_notifies_the_service_provider(): void
    {
        Mail::fake();

        [$staff, $contact, $application] = $this->filed();

        $created = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Hold this until the scan arrives.',
                'lane' => 'internal',
            ])->assertCreated()
            ->assertJsonPath('canShare', true)
            ->json();

        Mail::assertNothingQueued();
        $this->assertNull($this->attention($contact, $application));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages/'.$created['id'].'/share')
            ->assertOk()
            ->assertJsonPath('lane', 'provider')
            ->assertJsonPath('body', 'Hold this until the scan arrives.')
            ->assertJsonPath('canShare', false);

        $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk()
            ->assertJsonPath('messages.0.body', 'Hold this until the scan arrives.')
            ->assertJsonPath('messages.0.lane', 'provider')
            ->assertJsonPath('messages.0.canShare', false);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('gil@galaxy.example')
                && str_contains($mail->subjectLine, 'new message')
                && str_contains(json_encode($mail->payload), 'Hold this until the scan arrives.');
        });
        Mail::assertQueuedCount(1);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id, 'type' => 'cip.message',
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages/'.$created['id'].'/share')
            ->assertStatus(422);

        Mail::assertQueuedCount(1);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages/'.$created['id'].'/share')
            ->assertNotFound();
    }

    public function test_a_reader_shows_on_the_message_they_saw_and_not_on_an_internal_note(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $path = '/portal/cip/applications/'.$application->uuid.'/messages';

        Carbon::setTestNow(Carbon::parse('2026-09-22 12:00:00'));

        $this->actingAs($staff)
            ->postJson($path, ['body' => 'Keep this in the office.', 'lane' => 'internal'])
            ->assertCreated();

        $this->actingAs($staff)
            ->postJson($path, ['body' => 'Please send the scan.', 'lane' => 'provider'])
            ->assertCreated();

        $this->actingAs($contact)->getJson($path)->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-22 15:00:00'));

        $this->actingAs($staff)
            ->postJson($path, ['body' => 'Any news on the scan?', 'lane' => 'provider'])
            ->assertCreated();

        $this->actingAs($contact)->getJson($path)->assertOk();

        $messages = collect(
            $this->actingAs($staff)->getJson($path)->assertOk()->json('messages')
        );

        $internal = $messages->firstWhere('body', 'Keep this in the office.');
        $this->assertSame([], $internal['seenBy']);

        $first = $messages->firstWhere('body', 'Please send the scan.');
        $this->assertSame($contact->id, $first['seenBy'][0]['id']);
        $this->assertSame('Gil Contact', $first['seenBy'][0]['name']);
        $this->assertTrue(
            Carbon::parse($first['seenBy'][0]['seenAt'])->equalTo(Carbon::parse('2026-09-22 12:00:00'))
        );

        $second = $messages->firstWhere('body', 'Any news on the scan?');
        $this->assertTrue(
            Carbon::parse($second['seenBy'][0]['seenAt'])->equalTo(Carbon::parse('2026-09-22 15:00:00'))
        );

        Carbon::setTestNow();
    }

    /**
     * Reopening a thread you are already caught up on must say nothing.
     *
     * The read event goes to every tab on the file's channel, including the
     * one that did the reading, and a tab on the Messages tab answers it by
     * fetching the thread again — which marks it read again. So a read that
     * writes nothing new but still broadcasts is not a wasted event, it is a
     * cycle: fetch, broadcast, fetch, with the table repainting on every lap.
     */
    public function test_reopening_a_read_thread_broadcasts_nothing(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $path = '/portal/cip/applications/'.$application->uuid.'/messages';

        $this->actingAs($staff)
            ->postJson($path, ['body' => 'Please send the scan.', 'lane' => 'provider'])
            ->assertCreated();

        // First look: genuinely new, so the sender's screen does need telling.
        $this->actingAs($contact)->getJson($path)->assertOk();

        Event::fake([CipThreadChanged::class]);

        $this->actingAs($contact)->getJson($path)->assertOk();
        $this->actingAs($contact)->getJson($path)->assertOk();

        Event::assertNotDispatched(CipThreadChanged::class);
    }

    public function test_reopening_a_thread_whose_newest_message_is_your_own_broadcasts_nothing(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $path = '/portal/cip/applications/'.$application->uuid.'/messages';

        $this->actingAs($contact)
            ->postJson($path, ['body' => 'Scan attached.', 'lane' => 'provider'])
            ->assertCreated();

        $this->actingAs($staff)->getJson($path)->assertOk();

        // Staff answer: now the newest row is the staff reader's own, which
        // no receipt is ever written for.
        $this->actingAs($staff)
            ->postJson($path, ['body' => 'Received, thank you.', 'lane' => 'provider'])
            ->assertCreated();

        Event::fake([CipThreadChanged::class]);

        $this->actingAs($staff)->getJson($path)->assertOk();
        $this->actingAs($staff)->getJson($path)->assertOk();

        Event::assertNotDispatched(CipThreadChanged::class);
    }

    public function test_reopening_a_thread_after_an_internal_note_broadcasts_nothing(): void
    {
        [$staff, $contact, $application] = $this->filed();
        $path = '/portal/cip/applications/'.$application->uuid.'/messages';

        $this->actingAs($contact)
            ->postJson($path, ['body' => 'Scan attached.', 'lane' => 'provider'])
            ->assertCreated();

        $this->actingAs($staff)->getJson($path)->assertOk();
        $this->actingAs($contact)->getJson($path)->assertOk();

        $this->actingAs($staff)
            ->postJson($path, ['body' => 'Chase the medical.', 'lane' => 'internal'])
            ->assertCreated();

        Event::fake([CipThreadChanged::class]);

        // The provider cannot see the note, so their cursor cannot reach it.
        $this->actingAs($contact)->getJson($path)->assertOk();
        $this->actingAs($contact)->getJson($path)->assertOk();

        Event::assertNotDispatched(CipThreadChanged::class);
    }

    public function test_the_author_can_edit_their_message_for_fifteen_minutes(): void
    {
        Mail::fake();

        [$staff, $contact, $application] = $this->filed();
        $application->load('client');
        $path = '/portal/cip/applications/'.$application->uuid.'/messages';

        Carbon::setTestNow(Carbon::parse('2026-09-22 16:00:00'));

        $created = $this->actingAs($staff)
            ->postJson($path, ['body' => 'Please send the scan.', 'lane' => 'provider'])
            ->assertCreated()
            ->assertJsonPath('canEdit', true)
            ->json();

        $this->actingAs($staff)
            ->postJson('/portal/clients/'.$application->client->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated();

        $this->actingAs($contact)
            ->patchJson($path.'/'.$created['id'], ['body' => 'Changed by someone else'])
            ->assertForbidden();

        Carbon::setTestNow(Carbon::parse('2026-09-22 16:14:00'));

        $this->actingAs($staff)
            ->patchJson($path.'/'.$created['id'], ['body' => 'Please send the updated scan.'])
            ->assertOk()
            ->assertJsonPath('body', 'Please send the updated scan.')
            ->assertJsonPath('edited', true)
            ->assertJsonPath('lane', 'provider')
            ->assertJsonPath('canEdit', true);

        $opened = $this->actingAs($staff)
            ->postJson('/portal/clients/'.$application->client->uid.'/conversations', ['with' => 'provider'])
            ->assertCreated()
            ->json('conversation.id');

        $chat = collect($this->actingAs($staff)
            ->getJson('/portal/messaging/conversations/'.$opened.'/messages')
            ->assertOk()
            ->json('messages'))
            ->pluck('body');

        $this->assertTrue($chat->contains('Please send the updated scan.'));
        $this->assertFalse($chat->contains('Please send the scan.'));

        Carbon::setTestNow(Carbon::parse('2026-09-22 16:16:00'));

        $this->actingAs($staff)
            ->patchJson($path.'/'.$created['id'], ['body' => 'Too late'])
            ->assertForbidden();

        Carbon::setTestNow();
    }
}
