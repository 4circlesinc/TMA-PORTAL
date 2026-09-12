<?php

namespace App\Support\Bespoke;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Speech to text for the live voice, through the same OpenAI-compatible
 * host and key as the chat (`/audio/transcriptions`).
 *
 * The browser's own recognition is the first choice — it costs nothing
 * and needs no round trip — but Chromium's implementation is a call to a
 * Google service the desktop shell, Brave and unbranded builds do not
 * carry, and every start there ends in `network`. This is the second
 * choice: the browser records the clip, it is transcribed here and
 * thrown away. Groq serves Whisper on the chat key; OpenAI serves
 * whisper-1 on theirs. BESPOKE_AI_TRANSCRIBE_MODEL overrides the guess.
 */
final class Transcription
{
    public const MAX_BYTES = 10 * 1024 * 1024;

    /** Extension the provider sniffs the container from, by declared type. */
    private const EXTENSIONS = [
        'audio/webm' => 'webm',
        'video/webm' => 'webm',
        'audio/ogg' => 'ogg',
        'audio/mp4' => 'm4a',
        'video/mp4' => 'mp4',
        'audio/x-m4a' => 'm4a',
        'audio/m4a' => 'm4a',
        'audio/mpeg' => 'mp3',
        'audio/wav' => 'wav',
        'audio/x-wav' => 'wav',
        'audio/wave' => 'wav',
        'audio/flac' => 'flac',
    ];

    public static function model(): string
    {
        $configured = trim((string) config('services.bespoke.transcribe_model'));
        if ($configured !== '') {
            return $configured;
        }

        $host = (string) parse_url((string) config('services.bespoke.base_url'), PHP_URL_HOST);

        return str_contains($host, 'groq') ? 'whisper-large-v3-turbo' : 'whisper-1';
    }

    /**
     * The words in the clip; an empty string for silence; null when the
     * provider could not be reached or refused.
     */
    public static function transcribe(UploadedFile $audio, ?string $language = null): ?string
    {
        if (! Bespoke::configured()) {
            return null;
        }

        $key = trim((string) config('services.bespoke.key'));
        $base = rtrim(trim((string) config('services.bespoke.base_url')), '/');
        $model = self::model();
        $context = [
            'model' => $model,
            'host' => (string) parse_url($base, PHP_URL_HOST),
            'bytes' => $audio->getSize(),
        ];

        $fields = [
            'model' => $model,
            'response_format' => 'json',
            'temperature' => '0',
        ];
        if (is_string($language) && preg_match('/^[a-z]{2}$/i', $language) === 1) {
            $fields['language'] = strtolower($language);
        }

        try {
            $bytes = (string) file_get_contents((string) $audio->getRealPath());
            $response = Http::withToken($key)
                ->timeout(30)
                ->acceptJson()
                ->attach('file', $bytes, self::filename($audio))
                ->post($base.'/audio/transcriptions', $fields);
        } catch (\Throwable $e) {
            Log::warning('Bespoke AI transcription failed', $context + ['error' => $e->getMessage()]);

            return null;
        }

        if (! $response->successful()) {
            $message = $response->json('error.message');
            Log::warning('Bespoke AI transcription HTTP error', $context + [
                'status' => $response->status(),
                'code' => $response->json('error.code'),
                'message' => Str::limit(is_string($message) && $message !== '' ? $message : (string) $response->body(), 300),
            ]);

            return null;
        }

        $text = $response->json('text');

        return is_string($text) ? trim($text) : null;
    }

    /** `speech.<ext>` from the declared type, falling back to the upload's own name. */
    public static function filename(UploadedFile $audio): string
    {
        $type = strtolower(trim((string) explode(';', (string) $audio->getClientMimeType())[0]));
        $ext = self::EXTENSIONS[$type] ?? null;
        if ($ext === null) {
            $own = strtolower((string) $audio->getClientOriginalExtension());
            $ext = in_array($own, array_values(self::EXTENSIONS), true) ? $own : 'webm';
        }

        return 'speech.'.$ext;
    }
}
