<?php

namespace Tests\Feature;

use App\Models\BespokeAttachment;
use App\Models\BespokeConversation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Bespoke\Attachments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Files dropped into a Bespoke AI chat: staged on upload, five at most per
 * message, readable only by the reader who uploaded them, and handed to
 * the model as text.
 */
class BespokeAttachmentsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => 'gsk_test',
            'services.bespoke.base_url' => 'https://api.groq.com/openai/v1',
            'services.bespoke.model' => 'openai/gpt-oss-120b',
            'filesystems.files_disk' => 'local',
            'filesystems.envelope_encrypt' => false,
        ]);
        Storage::fake('local');
    }

    private function user(string $accountType, array $extra = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $extra));
    }

    private function pdf(string $name = 'report.pdf'): UploadedFile
    {
        $bytes = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";

        return UploadedFile::fake()->createWithContent($name, $bytes);
    }

    private function upload(User $user, string $conversationId, UploadedFile $file, array $extra = []): array
    {
        return $this->actingAs($user)
            ->post('/portal/bespoke/attachments', array_merge([
                'file' => $file,
                'conversationId' => $conversationId,
            ], $extra), ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('attachment');
    }

    public function test_a_pdf_is_staged_with_the_text_the_browser_read_and_only_its_owner_can_fetch_it(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $other = $this->user(Role::ADMINISTRATOR);
        $conversationId = (string) Str::uuid();

        $payload = $this->upload($officer, $conversationId, $this->pdf(), [
            'text' => "Page one says hello.\n\n\n\nPage two says goodbye.",
            'pages' => 2,
        ]);

        $this->assertTrue($payload['isPdf']);
        $this->assertTrue($payload['hasText']);
        $this->assertSame(2, $payload['pages']);
        $this->assertSame('report.pdf', $payload['name']);

        $row = BespokeAttachment::query()->where('uuid', $payload['id'])->firstOrFail();
        $this->assertNull($row->message_id);
        $this->assertSame("Page one says hello.\n\nPage two says goodbye.", $row->text);
        $this->assertSame($officer->id, $row->user_id);
        $this->assertSame($conversationId, $row->conversation->uuid);
        Storage::disk('local')->assertExists($row->path);

        $this->actingAs($officer)->get($payload['url'])->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->actingAs($officer)->get($payload['url'].'?download=1')->assertOk()->assertHeader('Content-Disposition', 'attachment; filename="report.pdf"');
        $this->actingAs($other)->get($payload['url'])->assertNotFound();
    }

    public function test_only_pdfs_images_and_text_files_are_accepted(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $conversationId = (string) Str::uuid();

        $this->actingAs($officer)->post('/portal/bespoke/attachments', [
            'file' => UploadedFile::fake()->create('macro.docx', 12, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            'conversationId' => $conversationId,
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $image = $this->upload($officer, $conversationId, UploadedFile::fake()->image('me.jpg', 900, 1200));
        $this->assertTrue($image['isImage']);
        $this->assertSame(900, $image['width']);
        $this->assertFalse($image['hasText']);

        $notes = $this->upload($officer, $conversationId, UploadedFile::fake()->createWithContent('notes.txt', "Line one\nLine two"));
        $this->assertTrue($notes['hasText']);
    }

    public function test_the_chat_hands_the_files_to_the_model_and_ties_them_to_the_turn(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $conversationId = (string) Str::uuid();
        $first = $this->upload($officer, $conversationId, $this->pdf('contract.pdf'), ['text' => 'The tenant pays on the first of the month.', 'pages' => 1]);
        $photo = $this->upload($officer, $conversationId, UploadedFile::fake()->image('photo.png', 800, 800));

        Http::fake([
            'api.groq.com/*' => Http::response([
                'choices' => [['finish_reason' => 'stop', 'message' => ['role' => 'assistant', 'content' => 'The contract says rent is due on the first.']]],
            ]),
        ]);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'Summarize the contract']],
                'conversationId' => $conversationId,
                'attachments' => [$first['id'], $photo['id']],
            ])
            ->assertOk()
            ->json();

        $this->assertSame('model', $payload['source']);

        Http::assertSent(function ($request) use ($first, $photo) {
            $messages = $request->data()['messages'];
            $system = $messages[0]['content'];
            $user = end($messages)['content'];
            $tools = array_column(array_column($request->data()['tools'], 'function'), 'name');

            return str_contains($user, '[Files attached to this message]')
                && str_contains($user, 'contract.pdf')
                && str_contains($user, 'The tenant pays on the first of the month.')
                && str_contains($user, 'You cannot see image contents')
                && str_contains($system, $first['id'])
                && str_contains($system, $photo['id'])
                && in_array('read_attachment', $tools, true)
                && in_array('resize_photo', $tools, true);
        });

        $conversation = BespokeConversation::query()->where('uuid', $conversationId)->firstOrFail();
        $turn = $conversation->messages()->where('role', 'user')->firstOrFail();
        $this->assertSame(2, $turn->attachments()->count());

        $detail = $this->actingAs($officer)->getJson('/portal/bespoke/conversations/'.$conversationId)->assertOk()->json('conversation');
        $names = array_column($detail['messages'][0]['attachments'], 'name');
        $this->assertSame(['contract.pdf', 'photo.png'], $names);

        // Once sent, a file cannot be claimed by a later message.
        Http::fake(['api.groq.com/*' => Http::response(['choices' => [['message' => ['content' => 'ok']]]])]);
        $this->actingAs($officer)->postJson('/portal/bespoke/chat', [
            'messages' => [['role' => 'user', 'content' => 'again']],
            'conversationId' => $conversationId,
            'attachments' => [$first['id']],
        ])->assertStatus(422);
    }

    public function test_five_files_at_most_and_only_this_readers_own(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $other = $this->user(Role::REVIEWING_OFFICER);
        $conversationId = (string) Str::uuid();
        $ids = [];
        for ($i = 0; $i < 6; $i++) {
            $ids[] = $this->upload($officer, $conversationId, UploadedFile::fake()->createWithContent("n{$i}.txt", 'x'))['id'];
        }

        $this->actingAs($officer)->postJson('/portal/bespoke/chat', [
            'messages' => [['role' => 'user', 'content' => 'all of them']],
            'conversationId' => $conversationId,
            'attachments' => $ids,
        ])->assertStatus(422);

        $theirs = $this->upload($other, (string) Str::uuid(), UploadedFile::fake()->createWithContent('theirs.txt', 'x'));
        $this->actingAs($officer)->postJson('/portal/bespoke/chat', [
            'messages' => [['role' => 'user', 'content' => 'not mine']],
            'conversationId' => $conversationId,
            'attachments' => [$theirs['id']],
        ])->assertStatus(422);
    }

    public function test_the_model_can_read_a_file_in_slices_and_ask_for_a_2x2_photo(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $conversationId = (string) Str::uuid();
        $long = str_repeat('Clause. ', 2000);
        $doc = $this->upload($officer, $conversationId, $this->pdf('long.pdf'), ['text' => $long, 'pages' => 9]);
        $photo = $this->upload($officer, $conversationId, UploadedFile::fake()->image('me.jpg', 1200, 1600));
        $tiny = $this->upload($officer, $conversationId, UploadedFile::fake()->image('tiny.jpg', 200, 200));

        $call = fn (string $name, array $args, int $i) => [
            'id' => 'call_'.$i, 'type' => 'function', 'function' => ['name' => $name, 'arguments' => json_encode($args)],
        ];
        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push(['choices' => [['finish_reason' => 'tool_calls', 'message' => ['role' => 'assistant', 'content' => null, 'tool_calls' => [
                    $call('read_attachment', ['attachmentId' => $doc['id'], 'offset' => 6000], 0),
                    $call('resize_photo', ['attachmentId' => $photo['id']], 1),
                    $call('resize_photo', ['attachmentId' => $tiny['id']], 2),
                ]]]]])
                ->push(['choices' => [['finish_reason' => 'stop', 'message' => ['role' => 'assistant', 'content' => 'Read it. Your 2×2 photo is below.']]]]),
        ]);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'read the rest and make my photo 2x2']],
                'conversationId' => $conversationId,
                'attachments' => [$doc['id'], $photo['id'], $tiny['id']],
            ])
            ->assertOk()
            ->json();

        $this->assertCount(1, $payload['actions']);
        $this->assertSame('photo2x2', $payload['actions'][0]['type']);
        $this->assertSame($photo['id'], $payload['actions'][0]['attachment']['id']);

        Http::assertSent(function ($request) {
            $tools = array_values(array_filter($request->data()['messages'], fn ($m) => $m['role'] === 'tool'));
            if (count($tools) !== 3) {
                return false;
            }
            $read = json_decode($tools[0]['content'], true);
            $big = json_decode($tools[1]['content'], true);
            $small = json_decode($tools[2]['content'], true);

            return $read['offset'] === 6000 && mb_strlen($read['text']) === 6000 && $read['nextOffset'] === 12000
                && ($big['ok'] ?? false) === true
                && str_contains($small['error'] ?? '', 'only 200×200');
        });
    }

    public function test_a_derived_photo_hangs_off_the_latest_turn_and_shows_on_reopen(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $conversationId = (string) Str::uuid();
        Http::fake(['api.groq.com/*' => Http::response(['choices' => [['message' => ['content' => 'Your photo is below.']]]])]);
        $this->actingAs($officer)->postJson('/portal/bespoke/chat', [
            'messages' => [['role' => 'user', 'content' => 'make it 2x2']],
            'conversationId' => $conversationId,
        ])->assertOk();

        $derived = $this->upload($officer, $conversationId, UploadedFile::fake()->image('me-2x2.jpg', 600, 600), ['kind' => 'derived']);
        $this->assertSame('derived', $derived['kind']);

        $row = BespokeAttachment::query()->where('uuid', $derived['id'])->firstOrFail();
        $this->assertNotNull($row->message_id);
        $this->assertSame('assistant', $row->message->role);

        $detail = $this->actingAs($officer)->getJson('/portal/bespoke/conversations/'.$conversationId)->assertOk()->json('conversation');
        $last = end($detail['messages']);
        $this->assertSame(['me-2x2.jpg'], array_column($last['attachments'], 'name'));

        // Not staged, so a later prune leaves it alone.
        $row->forceFill(['created_at' => now()->subDays(3)])->save();
        $this->assertSame(0, Attachments::prune($officer));
    }

    public function test_stale_staged_files_are_pruned_on_the_next_upload(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $conversationId = (string) Str::uuid();
        $old = $this->upload($officer, $conversationId, UploadedFile::fake()->createWithContent('old.txt', 'x'));
        $row = BespokeAttachment::query()->where('uuid', $old['id'])->firstOrFail();
        $row->forceFill(['created_at' => now()->subHours(30)])->save();
        $path = $row->path;

        $this->upload($officer, $conversationId, UploadedFile::fake()->createWithContent('new.txt', 'y'));

        $this->assertNull(BespokeAttachment::query()->where('uuid', $old['id'])->first());
        Storage::disk('local')->assertMissing($path);
        $this->assertSame(1, Attachments::forConversation(BespokeConversation::where('uuid', $conversationId)->firstOrFail(), $officer)->count());
    }
}
