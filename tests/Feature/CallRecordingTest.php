<?php

namespace Tests\Feature;

use App\Models\CallRecording;
use App\Models\Client;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * Client-call recording: the rule that only the staff side of a direct
 * staff↔client call ever records, and the area's scoping.
 *
 * The rule lives server-side on purpose (§ CallRecordingController): a
 * browser asks, it never decides — so most of these tests are about who is
 * told "no".
 */
class CallRecordingTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email, string $accountType = 'Employee'): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @param  array<int, User>  $members */
    private function conversation(array $members, string $type = Conversation::TYPE_DIRECT): Conversation
    {
        $c = Conversation::create([
            'type' => $type,
            'created_by' => $members[0]->id,
            'last_message_at' => now(),
        ]);
        foreach ($members as $u) {
            ConversationParticipant::create([
                'conversation_id' => $c->id,
                'user_id' => $u->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $c;
    }

    // ------------------------------------------------------------- start

    public function test_a_staff_call_with_a_client_gets_a_recording(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $body = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings', ['media' => 'audio'])
            ->assertCreated()
            ->json();

        $this->assertNotEmpty($body['recording']['id']);
        $this->assertDatabaseHas('call_recordings', [
            'conversation_id' => $c->id,
            'recorded_by' => $staff->id,
            'client_user_id' => $client->id,
            'client_name' => $client->name,
            'status' => 'recording',
        ]);
    }

    public function test_the_client_row_is_linked_when_one_exists(): void
    {
        $staff = $this->user('staff@example.com');
        $clientUser = $this->user('client@example.com', 'Client');
        $client = Client::create([
            'uid' => 'c-0001',
            'user_id' => $clientUser->id,
            'name' => $clientUser->name,
            'email' => $clientUser->email,
            'data' => [],
        ]);
        $c = $this->conversation([$staff, $clientUser]);

        $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->assertCreated();

        $this->assertDatabaseHas('call_recordings', [
            'conversation_id' => $c->id,
            'client_id' => $client->id,
        ]);
    }

    public function test_a_staff_to_staff_call_is_never_recorded(): void
    {
        $a = $this->user('a@example.com');
        $b = $this->user('b@example.com', 'Administrator');
        $c = $this->conversation([$a, $b]);

        $this->actingAs($a)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->assertOk()
            ->assertJsonPath('recording', null);

        $this->assertDatabaseCount('call_recordings', 0);
    }

    public function test_a_client_is_never_the_one_recording(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $this->actingAs($client)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->assertOk()
            ->assertJsonPath('recording', null);
    }

    public function test_a_group_call_is_not_recorded(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client], 'group');

        $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->assertOk()
            ->assertJsonPath('recording', null);
    }

    /**
     * Never resumed, always a fresh row: a new MediaRecorder is a new WebM
     * stream with its own init segment, so "continuing" an earlier row could
     * only splice two incompatible streams. A redial records again from zero
     * and the abandoned row settles as interrupted.
     */
    public function test_a_redial_gets_its_own_recording_row(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $first = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');
        $second = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');

        $this->assertNotSame($first, $second);
        $this->assertSame(2, CallRecording::count());
    }

    /** The stored Content-Type is derived server-side, never client-supplied —
     * a chosen mime like text/html would turn playback into stored XSS. */
    public function test_the_served_mime_cannot_be_chosen_by_the_uploader(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $id = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');

        $this->actingAs($staff)->post('/portal/messaging/recordings/'.$id.'/chunks', [
            'seq' => 0,
            'chunk' => UploadedFile::fake()->createWithContent('chunk.webm', '<script>alert(1)</script>'),
        ])->assertOk();

        $this->actingAs($staff)->postJson('/portal/messaging/recordings/'.$id.'/finish', [
            'durationMs' => 1000,
            'media' => 'audio',
            'mime' => 'text/html',
        ])->assertOk();

        $this->assertSame('audio/webm', CallRecording::where('uuid', $id)->value('mime'));
        $this->actingAs($staff)
            ->get('/portal/call-recordings/'.$id.'/media')
            ->assertOk()
            ->assertHeader('Content-Type', 'audio/webm');
    }

    /** Seeking a long recording needs byte ranges, not a front-to-back download. */
    public function test_the_media_endpoint_honours_a_byte_range(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $id = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');
        $this->actingAs($staff)->post('/portal/messaging/recordings/'.$id.'/chunks', [
            'seq' => 0,
            'chunk' => UploadedFile::fake()->createWithContent('chunk.webm', 'abcdefghij'),
        ]);
        $this->actingAs($staff)->postJson('/portal/messaging/recordings/'.$id.'/finish', [
            'durationMs' => 1000,
        ]);

        $response = $this->actingAs($staff)
            ->get('/portal/call-recordings/'.$id.'/media', ['Range' => 'bytes=2-5']);

        $response->assertStatus(206)
            ->assertHeader('Content-Range', 'bytes 2-5/10')
            ->assertHeader('Accept-Ranges', 'bytes');
        $this->assertSame('cdef', $response->streamedContent());
    }

    // ---------------------------------------------------- chunks + finish

    public function test_chunks_assemble_in_order_and_finish_stores_the_file(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $id = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');

        foreach ([[0, 'alpha-'], [1, 'beta-'], [2, 'gamma']] as [$seq, $bytes]) {
            $this->actingAs($staff)->post('/portal/messaging/recordings/'.$id.'/chunks', [
                'seq' => $seq,
                'chunk' => UploadedFile::fake()->createWithContent('chunk.webm', $bytes),
            ])->assertOk();
        }

        // A retried chunk whose first attempt landed must not double-append.
        $this->actingAs($staff)->post('/portal/messaging/recordings/'.$id.'/chunks', [
            'seq' => 1,
            'chunk' => UploadedFile::fake()->createWithContent('chunk.webm', 'beta-'),
        ])->assertOk();

        $this->actingAs($staff)->postJson('/portal/messaging/recordings/'.$id.'/finish', [
            'durationMs' => 34000,
            'media' => 'audio',
            'mime' => 'audio/webm;codecs=opus',
        ])->assertOk();

        $recording = CallRecording::where('uuid', $id)->first();
        $this->assertSame('ready', $recording->status);
        $this->assertSame(34000, (int) $recording->duration_ms);
        $this->assertNotNull($recording->path);

        // The assembled bytes stream back, in sequence order, once.
        $content = $this->actingAs($staff)
            ->get('/portal/call-recordings/'.$id.'/media')
            ->assertOk()
            ->streamedContent();
        $this->assertSame('alpha-beta-gamma', $content);
    }

    public function test_finishing_with_nothing_captured_marks_the_row_failed(): void
    {
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $id = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');

        $this->actingAs($staff)->postJson('/portal/messaging/recordings/'.$id.'/finish', [
            'failed' => true,
        ])->assertOk();

        $this->assertSame('failed', CallRecording::where('uuid', $id)->value('status'));
    }

    public function test_only_the_recorder_may_feed_a_recording(): void
    {
        $staff = $this->user('staff@example.com');
        $other = $this->user('other@example.com');
        $client = $this->user('client@example.com', 'Client');
        $c = $this->conversation([$staff, $client]);

        $id = $this->actingAs($staff)
            ->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings')
            ->json('recording.id');

        $this->actingAs($other)->post('/portal/messaging/recordings/'.$id.'/chunks', [
            'seq' => 0,
            'chunk' => UploadedFile::fake()->createWithContent('chunk.webm', 'stolen'),
        ])->assertNotFound();
    }

    // -------------------------------------------------------------- area

    public function test_an_employee_sees_their_own_recordings_only(): void
    {
        $mine = $this->user('mine@example.com');
        $theirs = $this->user('theirs@example.com');
        $client = $this->user('client@example.com', 'Client');

        $c1 = $this->conversation([$mine, $client]);
        $c2 = $this->conversation([$theirs, $client]);
        $this->actingAs($mine)->postJson('/portal/messaging/conversations/'.$c1->uuid.'/recordings');
        $this->actingAs($theirs)->postJson('/portal/messaging/conversations/'.$c2->uuid.'/recordings');

        $rows = $this->actingAs($mine)->getJson('/portal/call-recordings')
            ->assertOk()->json('recordings');

        $this->assertCount(1, $rows);
    }

    public function test_an_administrator_sees_the_firms_recordings(): void
    {
        $admin = $this->user('admin@example.com', 'Administrator');
        $staff = $this->user('staff@example.com');
        $client = $this->user('client@example.com', 'Client');

        $c = $this->conversation([$staff, $client]);
        $this->actingAs($staff)->postJson('/portal/messaging/conversations/'.$c->uuid.'/recordings');

        $rows = $this->actingAs($admin)->getJson('/portal/call-recordings')
            ->assertOk()->json('recordings');

        $this->assertCount(1, $rows);
    }

    public function test_a_client_never_reaches_the_area(): void
    {
        $client = $this->user('client@example.com', 'Client');

        $this->actingAs($client)->getJson('/portal/call-recordings')->assertNotFound();
    }

    public function test_search_and_client_filter_scope_the_list(): void
    {
        $staff = $this->user('staff@example.com');
        $ann = $this->user('ann@example.com', 'Client');
        $bob = $this->user('bob@example.com', 'Client');

        $c1 = $this->conversation([$staff, $ann]);
        $c2 = $this->conversation([$staff, $bob]);
        $this->actingAs($staff)->postJson('/portal/messaging/conversations/'.$c1->uuid.'/recordings');
        $this->actingAs($staff)->postJson('/portal/messaging/conversations/'.$c2->uuid.'/recordings');

        $rows = $this->actingAs($staff)->getJson('/portal/call-recordings?q='.urlencode($ann->name))
            ->assertOk()->json('recordings');

        $this->assertCount(1, $rows);
        $this->assertSame($ann->name, $rows[0]['clientName']);
    }
}
