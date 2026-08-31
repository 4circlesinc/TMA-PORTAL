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
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * §24 — the application messaging centre.
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

    public function test_an_officer_who_does_not_hold_the_file_is_told_it_does_not_exist(): void
    {
        [$staff, , $application] = $this->filed();
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');

        $this->actingAs($officer)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertNotFound();

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', [
                'body' => 'Should not land.',
            ])->assertNotFound();

        Assignments::assign($application, $officer, $staff);

        $this->actingAs($officer)
            ->getJson('/portal/cip/applications/'.$application->uuid.'/messages')
            ->assertOk();
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
}
