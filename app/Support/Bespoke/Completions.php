<?php

namespace App\Support\Bespoke;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Optional OpenAI-compatible chat completion. Missing key means the
 * controller stays on the local FAQ — the panel still opens.
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

        $key = (string) config('services.bespoke.key');
        $base = rtrim((string) config('services.bespoke.base_url'), '/');
        $model = (string) config('services.bespoke.model');

        $payload = [
            'model' => $model,
            'temperature' => 0.2,
            'max_tokens' => 700,
            'messages' => array_merge(
                [['role' => 'system', 'content' => $system]],
                $messages,
            ),
        ];

        try {
            $response = Http::withToken($key)
                ->timeout(45)
                ->acceptJson()
                ->post($base.'/chat/completions', $payload);
        } catch (\Throwable $e) {
            Log::warning('Bespoke AI request failed', ['error' => $e->getMessage()]);

            return null;
        }

        if (! $response->successful()) {
            Log::warning('Bespoke AI HTTP error', [
                'status' => $response->status(),
            ]);

            return null;
        }

        $text = $response->json('choices.0.message.content');

        return is_string($text) && trim($text) !== '' ? trim($text) : null;
    }
}
