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
 * BESPOKE_AI_MODEL may list several models, comma-separated, in order of
 * preference. A model the host reports as unknown or decommissioned
 * (hosts retire them without notice — Groq dropped llama-3.3-70b in
 * Sep 2026 and the assistant went dark) hands over to the next one;
 * every other failure stops there, since a bad key or a quota block
 * would fail every model the same way.
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

        $chat = array_merge(
            [['role' => 'system', 'content' => $system]],
            $messages,
        );

        foreach (self::models() as $model) {
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

            if ($result['text'] !== null || ! $result['next']) {
                return $result['text'];
            }
        }

        return null;
    }

    /**
     * Configured models in order of preference.
     *
     * @return list<string>
     */
    public static function models(): array
    {
        $raw = (string) config('services.bespoke.model');
        $models = [];
        foreach (explode(',', $raw) as $model) {
            $model = trim($model);
            if ($model !== '' && ! in_array($model, $models, true)) {
                $models[] = $model;
            }
        }

        return $models;
    }

    /**
     * `retry` asks for the same model in the newer dialect; `next` says
     * this host does not know the model and the next listed one should
     * be tried.
     *
     * @param  array<string, mixed>  $payload
     * @return array{text: ?string, retry: bool, next: bool}
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

            return ['text' => null, 'retry' => false, 'next' => false];
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

            $code = $response->json('error.code');
            $next = in_array($code, ['model_not_found', 'model_decommissioned'], true)
                || ($response->status() === 404 && preg_match('/\\bmodel\\b/i', $message) === 1)
                || preg_match('/decommissioned/i', $message) === 1;

            return ['text' => null, 'retry' => $retry, 'next' => $next];
        }

        $text = $response->json('choices.0.message.content');
        if (! is_string($text) || trim($text) === '') {
            Log::warning('Bespoke AI empty reply', $context + [
                'finish' => $response->json('choices.0.finish_reason'),
                'message' => Str::limit(self::errorMessage($response), 300),
            ]);

            return ['text' => null, 'retry' => false, 'next' => false];
        }

        return ['text' => trim($text), 'retry' => false, 'next' => false];
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
