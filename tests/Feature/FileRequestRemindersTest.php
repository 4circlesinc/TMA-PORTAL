<?php

namespace Tests\Feature;

use App\Models\EmailDelivery;
use App\Models\FileLibrarySetting;
use App\Models\FileRequest;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Item 8: the Request Files form's rules, a portal user as the recipient,
 * and reminders — on a frequency the firm controls, by email and in the
 * portal, by themselves and by hand.
 */
class FileRequestRemindersTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-rem-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
        Mail::fake();
    }

    private function user(string $type, string $email, string $name): User
    {
        return User::factory()->create([
            'name' => $name,
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function create(User $as, array $payload = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($as)->postJson('/portal/files/requests', array_merge([
            'title' => 'Your bank statements',
            'message' => 'The last three months, every page.',
            'allowedExtensions' => ['pdf'],
        ], $payload));
    }

    public function test_instructions_and_a_file_type_are_required_and_the_defaults_are_five_pdfs(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER, 'sam@firm.test', 'Sam Staff');

        $this->actingAs($staff)->postJson('/portal/files/requests', ['title' => 'Statements'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['message', 'allowedExtensions']);

        // A name without an address (or the other way round) is not a recipient.
        $this->create($staff, ['recipientName' => 'Jane Doe'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['recipientEmail']);

        $this->create($staff)->assertCreated();
        $request = FileRequest::query()->latest('id')->firstOrFail();
        $this->assertSame(5, (int) $request->max_files);
        $this->assertSame(['pdf'], $request->allowed_extensions);
        // The firm's reminder frequency, unless somebody chose otherwise.
        $this->assertSame(3, (int) $request->reminder_every_days);

        $this->actingAs($staff)->getJson('/portal/files/requests/options')
            ->assertOk()
            ->assertJsonPath('reminders.days', 3)
            ->assertJsonPath('reminders.choosable', true)
            ->assertJsonPath('defaults.maxFiles', 5)
            ->assertJsonPath('defaults.allowedExtensions', ['pdf']);
    }

    public function test_a_portal_user_is_asked_by_email_in_the_bell_and_in_messages(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER, 'sam@firm.test', 'Sam Staff');
        $colleague = $this->user(Role::REVIEWING_OFFICER, 'kim@firm.test', 'Kim Colleague');

        $this->create($staff, ['recipientUserId' => $colleague->id, 'send' => true])
            ->assertCreated()
            ->assertJsonPath('emailed', true)
            ->assertJsonPath('request.recipientEmail', 'kim@firm.test')
            ->assertJsonPath('request.recipientName', 'Kim Colleague');

        $request = FileRequest::query()->latest('id')->firstOrFail();
        $this->assertSame($colleague->id, (int) $request->recipient_user_id);

        $this->assertDatabaseHas('email_deliveries', ['recipient' => 'kim@firm.test', 'related_id' => $request->id]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $colleague->id,
            'type' => 'files.request_received',
            'action_url' => '/r/'.$request->token,
        ]);
        $message = Message::query()->where('user_id', $staff->id)->latest('id')->first();
        $this->assertNotNull($message, 'A message from the person asking is in their Messages.');
        $this->assertStringContainsString('/r/'.$request->token, (string) $message->body);
    }

    public function test_a_client_may_only_ask_somebody_they_can_reach(): void
    {
        $client = $this->user(Role::CLIENT, 'cleo@client.test', 'Cleo Client');
        $stranger = $this->user(Role::CLIENT, 'other@client.test', 'Other Client');

        $this->create($client, ['recipientUserId' => $stranger->id])->assertStatus(422);
        $this->assertSame(0, FileRequest::count());
    }

    public function test_reminders_go_at_the_requests_frequency_and_stop_once_answered(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER, 'sam@firm.test', 'Sam Staff');
        $colleague = $this->user(Role::REVIEWING_OFFICER, 'kim@firm.test', 'Kim Colleague');

        $this->create($staff, [
            'recipientUserId' => $colleague->id,
            'reminderEveryDays' => 1,
            'send' => true,
        ])->assertCreated();
        $request = FileRequest::query()->latest('id')->firstOrFail();
        $reminders = fn () => EmailDelivery::query()->where('related_id', $request->id)->where('template', 'fileRequestReminder')->count();

        // Not yet: a day has not passed.
        $this->artisan('files:send-request-reminders')->assertSuccessful();
        $this->assertSame(0, $reminders());

        $this->travel(25)->hours();
        $this->artisan('files:send-request-reminders')->assertSuccessful();
        $this->assertSame(1, $reminders());
        $this->assertSame(1, (int) $request->fresh()->reminders_sent);
        $this->assertDatabaseHas('portal_notifications', ['user_id' => $colleague->id, 'type' => 'files.request_reminder']);

        // Once a reminder has gone, the next waits for its own day.
        $this->artisan('files:send-request-reminders')->assertSuccessful();
        $this->assertSame(1, $reminders());

        // Answered: nobody is reminded again.
        auth()->logout();
        $this->post('/r/'.$request->token.'/upload', [
            'file' => UploadedFile::fake()->create('statement.pdf', 12, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertCreated();
        $this->travel(3)->days();
        $this->artisan('files:send-request-reminders')->assertSuccessful();
        $this->assertSame(1, $reminders());
    }

    public function test_a_reminder_can_be_sent_by_hand_while_the_request_is_outstanding(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER, 'sam@firm.test', 'Sam Staff');
        $this->create($staff, ['recipientName' => 'Jane Doe', 'recipientEmail' => 'jane@example.com', 'send' => true])->assertCreated();
        $request = FileRequest::query()->latest('id')->firstOrFail();

        $this->actingAs($staff)->postJson('/portal/files/requests/'.$request->uuid.'/remind')
            ->assertOk()
            ->assertJsonPath('emailed', 1)
            ->assertJsonPath('request.remindersSent', 1);

        // Somebody else's request is not theirs to chase.
        $other = $this->user(Role::REVIEWING_OFFICER, 'ola@firm.test', 'Ola Other');
        $this->actingAs($other)->postJson('/portal/files/requests/'.$request->uuid.'/remind')->assertForbidden();

        // Answered: there is nothing to remind them of.
        auth()->logout();
        $this->post('/r/'.$request->token.'/upload', [
            'file' => UploadedFile::fake()->create('statement.pdf', 12, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertCreated();
        $this->actingAs($staff)->postJson('/portal/files/requests/'.$request->uuid.'/remind')->assertStatus(422);
    }

    public function test_administrators_control_the_reminder_frequency(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@firm.test', 'Ada Admin');
        $staff = $this->user(Role::REVIEWING_OFFICER, 'sam@firm.test', 'Sam Staff');

        // Only administrators change the firm's settings, and only to a frequency on offer.
        $this->actingAs($staff)->putJson('/portal/file-library/settings', ['requestReminderDays' => 7])->assertForbidden();
        $this->actingAs($admin)->putJson('/portal/file-library/settings', ['requestReminderDays' => 5])->assertStatus(422);
        $this->actingAs($admin)->putJson('/portal/file-library/settings', [
            'requestReminderDays' => 7,
            'requestReminderChoosable' => false,
        ])->assertOk();
        $this->assertSame(7, FileLibrarySetting::requestReminderDays());

        // Locked: a member of staff's choice gives way to the firm's.
        $this->create($staff, ['reminderEveryDays' => 1])->assertCreated();
        $this->assertSame(7, (int) FileRequest::query()->latest('id')->value('reminder_every_days'));
        $this->actingAs($staff)->getJson('/portal/files/requests/options')->assertJsonPath('reminders.choosable', false);

        // An administrator still chooses.
        $this->create($admin, ['reminderEveryDays' => 0])->assertCreated();
        $this->assertSame(0, (int) FileRequest::query()->latest('id')->value('reminder_every_days'));
    }
}
