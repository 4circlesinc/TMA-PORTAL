<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Bespoke\Transcription;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The live voice's fallback ear: a recorded clip is transcribed through
 * the chat provider's /audio/transcriptions and never kept. The model is
 * guessed from the host unless set; a dark feature is a 404, a missing key
 * a 503, a refusing provider a 502.
 */
class BespokeTranscribeTest extends TestCase
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
            'services.bespoke.transcribe_model' => null,
        ]);
    }

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function clip(string $mime = 'audio/webm', string $name = 'speech.webm'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, str_repeat("\x1A\x45\xDF\xA3", 64))
            ->mimeType($mime);
    }

    public function test_a_clip_is_transcribed_through_the_chat_provider(): void
    {
        Http::fake([
            'https://api.groq.com/openai/v1/audio/transcriptions' => Http::response(['text' => '  where is the file library '], 200),
        ]);

        $response = $this->actingAs($this->user())
            ->post('/portal/bespoke/transcribe', ['audio' => $this->clip(), 'language' => 'EN'], ['Accept' => 'application/json']);

        $response->assertOk()->assertJson(['text' => 'where is the file library']);

        Http::assertSent(function (ClientRequest $request) {
            $fields = [];
            foreach ($request->data() as $part) {
                if (isset($part['name'])) {
                    $fields[$part['name']] = $part;
                }
            }

            return $request->url() === 'https://api.groq.com/openai/v1/audio/transcriptions'
                && $request->hasHeader('Authorization', 'Bearer gsk_test')
                && ($fields['model']['contents'] ?? null) === 'whisper-large-v3-turbo'
                && ($fields['language']['contents'] ?? null) === 'en'
                && ($fields['file']['filename'] ?? null) === 'speech.webm'
                && strlen((string) ($fields['file']['contents'] ?? '')) === 256;
        });
    }

    public function test_the_model_follows_the_host_unless_set(): void
    {
        $this->assertSame('whisper-large-v3-turbo', Transcription::model());

        config(['services.bespoke.base_url' => 'https://api.openai.com/v1']);
        $this->assertSame('whisper-1', Transcription::model());

        config(['services.bespoke.transcribe_model' => 'distil-whisper-large-v3-en']);
        $this->assertSame('distil-whisper-large-v3-en', Transcription::model());
    }

    public function test_the_filename_carries_the_container(): void
    {
        $this->assertSame('speech.m4a', Transcription::filename($this->clip('audio/mp4', 'speech.m4a')));
        $this->assertSame('speech.ogg', Transcription::filename($this->clip('audio/ogg;codecs=opus', 'speech.ogg')));
        $this->assertSame('speech.webm', Transcription::filename($this->clip('application/octet-stream', 'blob')));
        $this->assertSame('speech.wav', Transcription::filename($this->clip('application/octet-stream', 'take.wav')));
    }

    public function test_a_refusing_provider_is_a_502_and_nothing_is_kept(): void
    {
        Http::fake([
            'https://api.groq.com/openai/v1/audio/transcriptions' => Http::response(['error' => ['message' => 'bad audio']], 400),
        ]);

        $this->actingAs($this->user())
            ->post('/portal/bespoke/transcribe', ['audio' => $this->clip()], ['Accept' => 'application/json'])
            ->assertStatus(502);

        $this->assertDatabaseCount('bespoke_attachments', 0);
    }

    public function test_no_key_is_a_503_and_the_provider_is_never_called(): void
    {
        config(['services.bespoke.key' => null]);
        Http::fake();

        $this->actingAs($this->user())
            ->post('/portal/bespoke/transcribe', ['audio' => $this->clip()], ['Accept' => 'application/json'])
            ->assertStatus(503);

        Http::assertNothingSent();
    }

    public function test_a_dark_feature_is_a_404(): void
    {
        config(['services.bespoke.enabled' => false]);

        $this->actingAs($this->user())
            ->post('/portal/bespoke/transcribe', ['audio' => $this->clip()], ['Accept' => 'application/json'])
            ->assertNotFound();
    }

    public function test_the_clip_is_required_and_the_language_is_two_letters(): void
    {
        Http::fake();
        $user = $this->user();

        $this->actingAs($user)
            ->post('/portal/bespoke/transcribe', [], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['audio']);

        $this->actingAs($user)
            ->post('/portal/bespoke/transcribe', ['audio' => $this->clip(), 'language' => 'english'], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['language']);

        Http::assertNothingSent();
    }
}
