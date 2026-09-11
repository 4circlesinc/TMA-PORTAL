<?php

namespace App\Support\Bespoke;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Optional OpenAI-compatible chat completion. Missing key means the
 * controller stays on the local FAQ — the panel still opens.
 *
 * The first attempt speaks the classic dialect (max_tokens, temperature)
 * because every OpenAI-compatible host accepts it. Newer OpenAI models
 * (gpt-5 and the o-series) reject those two parameters with a 400 that
 * names them; that one case is retried in their dialect instead of
 * falling to the FAQ. Every failure logs the provider's own message so
 * the reason is readable in the environment logs.
 */
final class Completions
{
    /**
     * @param  list<array{role: string, content: string}>  $messages
     */
    public static function complete(string $system, array $messages): ?string
    {
        if (! Bespoke::configured()) {
            return null;
        }

        $key = trim((string) config('services.bespoke.key'));
        $base = rtrim(trim((string) config('services.bespoke.base_url')), '/');
        $model = trim((string) config('services.bespoke.model'));

        $chat = array_merge(
            [['role' => 'system', 'content' => $system]],
            $messages,
        );

        $result = self::request($key, $base, $model, [
            'model' => $model,
            'temperature' => 0.2,
            'max_tokens' => 700,
            'messages' => $chat,
        ]);

        if ($result['retry']) {
            $result = self::request($key, $base, $model, [
                'model' => $model,
                'max_completion_tokens' => 1500,
                'messages' => $chat,
            ]);
        }

        return $result['text'];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{text: ?string, retry: bool}
     */
    private static function request(string $key, string $base, string $model, array $payload): array
    {
        $context = [
            'model' => $model,
            'host' => (string) parse_url($base, PHP_URL_HOST),
        ];

        try {
            $response = Http::withToken($key)
                ->timeout(45)
                ->acceptJson()
                ->post($base.'/chat/completions', $payload);
        } catch (\Throwable $e) {
            Log::warning('Bespoke AI request failed', $context + ['error' => $e->getMessage()]);

            return ['text' => null, 'retry' => false];
        }

        if (! $response->successful()) {
            $message = self::errorMessage($response);
            Log::warning('Bespoke AI HTTP error', $context + [
                'status' => $response->status(),
                'code' => $response->json('error.code'),
                'type' => $response->json('error.type'),
                'message' => Str::limit($message, 300),
            ]);

            $retry = $response->status() === 400
                && array_key_exists('max_tokens', $payload)
                && preg_match('/max_tokens|temperature/i', $message) === 1;

            return ['text' => null, 'retry' => $retry];
        }

        $text = $response->json('choices.0.message.content');
        if (! is_string($text) || trim($text) === '') {
            Log::warning('Bespoke AI empty reply', $context + [
                'finish' => $response->json('choices.0.finish_reason'),
                'message' => Str::limit(self::errorMessage($response), 300),
            ]);

            return ['text' => null, 'retry' => false];
        }

        return ['text' => trim($text), 'retry' => false];
    }

    private static function errorMessage(Response $response): string
    {
        $message = $response->json('error.message');
        if (is_string($message) && $message !== '') {
            return $message;
        }

        $body = trim((string) $response->body());

        return $body !== '' ? $body : '(empty body)';
    }
}
