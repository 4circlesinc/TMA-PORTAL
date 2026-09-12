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
        return self::models()[0];
    }

    /**
     * Models to try, in order. BESPOKE_AI_TRANSCRIBE_MODEL may list several,
     * comma-separated, like BESPOKE_AI_MODEL; a retired one hands over to
     * the next. Unset, the host decides: Groq serves Whisper large-v3-turbo
     * and large-v3, OpenAI serves whisper-1.
     *
     * @return list<string>
     */
    public static function models(): array
    {
        // A switch-like value ("true", "on", "1") is someone turning the
        // feature on, not naming a model; sent to the host it would be a
        // model called "true", refused on every clip. Fall back instead.
        $configured = array_values(array_filter(
            array_map('trim', explode(',', (string) config('services.bespoke.transcribe_model'))),
            fn (string $m) => $m !== '' && preg_match('/^(true|false|yes|no|on|off|0|1|null|default|auto)$/i', $m) !== 1,
        ));
        if ($configured !== []) {
            return $configured;
        }

        $host = (string) parse_url((string) config('services.bespoke.base_url'), PHP_URL_HOST);

        return str_contains($host, 'groq')
            ? ['whisper-large-v3-turbo', 'whisper-large-v3']
            : ['whisper-1'];
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
        $bytes = (string) file_get_contents((string) $audio->getRealPath());
        $filename = self::filename($audio);
        $type = self::partType($filename);

        $fields = ['response_format' => 'json', 'temperature' => '0'];
        if (is_string($language) && preg_match('/^[a-z]{2}$/i', $language) === 1) {
            $fields['language'] = strtolower($language);
        }

        foreach (self::models() as $model) {
            $context = [
                'model' => $model,
                'host' => (string) parse_url($base, PHP_URL_HOST),
                'bytes' => strlen($bytes),
                'file' => $filename,
            ];

            try {
                $response = Http::withToken($key)
                    ->timeout(30)
                    ->acceptJson()
                    ->attach('file', $bytes, $filename, ['Content-Type' => $type])
                    ->post($base.'/audio/transcriptions', $fields + ['model' => $model]);
            } catch (\Throwable $e) {
                Log::warning('Bespoke AI transcription failed', $context + ['error' => $e->getMessage()]);

                return null;
            }

            if ($response->successful()) {
                $text = $response->json('text');

                return is_string($text) ? trim($text) : null;
            }

            $message = $response->json('error.message');
            $message = is_string($message) && $message !== '' ? $message : (string) $response->body();
            $code = $response->json('error.code');
            Log::warning('Bespoke AI transcription HTTP error', $context + [
                'status' => $response->status(),
                'code' => $code,
                'message' => Str::limit($message, 300),
            ]);

            // Only a model the host no longer serves hands over; a bad key
            // or a bad clip would fail every model the same way.
            $retired = in_array($code, ['model_not_found', 'model_decommissioned'], true)
                || ($response->status() === 404 && preg_match('/\\bmodel\\b/i', $message) === 1)
                || preg_match('/decommissioned/i', $message) === 1;
            if (! $retired) {
                return null;
            }
        }

        return null;
    }

    /** The multipart part's type: what the browser recorded, not a guess from ".webm". */
    public static function partType(string $filename): string
    {
        return match (strtolower((string) pathinfo($filename, PATHINFO_EXTENSION))) {
            'webm' => 'audio/webm',
            'ogg' => 'audio/ogg',
            'm4a', 'mp4' => 'audio/mp4',
            'mp3' => 'audio/mpeg',
            'wav' => 'audio/wav',
            'flac' => 'audio/flac',
            default => 'application/octet-stream',
        };
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
