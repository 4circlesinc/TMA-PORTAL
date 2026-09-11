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
 *
 * With a Toolbox the call becomes a loop: the model may answer with tool
 * calls, each is run here on the server under the reader's own identity,
 * and the results go back until the model writes text. The loop is
 * bounded; a model that keeps calling tools gets one last, tool-less
 * request for a plain answer.
 */
final class Completions
{
    /** Rounds of tool calls before the model is asked to just answer. */
    public const MAX_TOOL_ROUNDS = 5;

    /** Longest single wait on a 429 before giving the turn up, in seconds. */
    public const MAX_RATE_WAIT = 8.0;

    /** @var (callable(float): void)|null  Sleeps between rate-limited tries; tests replace it. */
    public static $sleeper = null;

    /**
     * @param  list<array{role: string, content: string}>  $messages
     */
    public static function complete(string $system, array $messages): ?string
    {
        return self::run($system, $messages, null);
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     */
    public static function run(string $system, array $messages, ?Toolbox $toolbox): ?string
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
        $tools = $toolbox ? $toolbox->definitions() : [];

        foreach (self::models() as $model) {
            $outcome = self::converse($key, $base, $model, $chat, $tools, $toolbox);
            if ($outcome['text'] !== null || ! $outcome['next']) {
                return $outcome['text'];
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
     * The tool loop for one model.
     *
     * @param  list<array<string, mixed>>  $chat
     * @param  list<array<string, mixed>>  $tools
     * @return array{text: ?string, next: bool}
     */
    private static function converse(string $key, string $base, string $model, array $chat, array $tools, ?Toolbox $toolbox): array
    {
        $modern = false;

        for ($round = 0; $round < self::MAX_TOOL_ROUNDS; $round++) {
            $result = self::request($key, $base, $model, self::payload($model, $chat, $tools, $modern));
            if ($result['retry'] && ! $modern) {
                $modern = true;
                $result = self::request($key, $base, $model, self::payload($model, $chat, $tools, true));
            }
            if ($result['message'] === null) {
                return ['text' => null, 'next' => $result['next']];
            }

            $message = $result['message'];
            $calls = is_array($message['tool_calls'] ?? null) ? array_values($message['tool_calls']) : [];
            if ($calls === [] || $toolbox === null) {
                return ['text' => self::text($message), 'next' => false];
            }

            $chat[] = [
                'role' => 'assistant',
                'content' => is_string($message['content'] ?? null) ? $message['content'] : null,
                'tool_calls' => $calls,
            ];
            foreach ($calls as $call) {
                $name = (string) ($call['function']['name'] ?? '');
                $raw = $call['function']['arguments'] ?? '{}';
                $args = is_string($raw) ? json_decode($raw, true) : $raw;
                $chat[] = [
                    'role' => 'tool',
                    'tool_call_id' => (string) ($call['id'] ?? ''),
                    'content' => json_encode(
                        $toolbox->call($name, is_array($args) ? $args : []),
                        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
                    ),
                ];
            }
        }

        // Out of rounds: one plain request, no tools, so the reader still
        // gets an answer rather than the FAQ.
        $result = self::request($key, $base, $model, self::payload($model, $chat, [], $modern));

        return [
            'text' => $result['message'] !== null ? self::text($result['message']) : null,
            'next' => false,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $chat
     * @param  list<array<string, mixed>>  $tools
     * @return array<string, mixed>
     */
    private static function payload(string $model, array $chat, array $tools, bool $modern): array
    {
        $payload = ['model' => $model, 'messages' => $chat];
        // Reasoning models spend the budget thinking before they answer; a
        // tool round with a guide section in it ran out at 900 and came
        // back empty. gpt-oss also takes a reasoning_effort knob on Groq.
        if ($modern) {
            $payload['max_completion_tokens'] = 3000;
        } else {
            $payload['temperature'] = 0.2;
            $payload['max_tokens'] = 2000;
        }
        if (preg_match('/gpt-oss/i', $model) === 1) {
            $payload['reasoning_effort'] = 'low';
        }
        if ($tools !== []) {
            $payload['tools'] = $tools;
            $payload['tool_choice'] = 'auto';
        }

        return $payload;
    }

    /** @param  array<string, mixed>  $message */
    private static function text(array $message): ?string
    {
        $text = $message['content'] ?? null;

        return is_string($text) && trim($text) !== '' ? trim($text) : null;
    }

    /**
     * `retry` asks for the same request in the newer dialect; `next` says
     * this host does not know the model and the next listed one should
     * be tried. `message` is choices.0.message, or null on any failure.
     *
     * @param  array<string, mixed>  $payload
     * @return array{message: ?array<string, mixed>, retry: bool, next: bool}
     */
    private static function request(string $key, string $base, string $model, array $payload, int $attempt = 0): array
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

            return ['message' => null, 'retry' => false, 'next' => false];
        }

        // A per-minute token limit (Groq's on-demand tier: 8k TPM on
        // gpt-oss-120b, and a tool round is ~3k) answers 429 with the wait
        // it wants. Waiting it out once or twice beats telling the reader
        // the model is unreachable.
        if ($response->status() === 429 && $attempt < 2) {
            $wait = self::retryAfter($response);
            if ($wait !== null && $wait <= self::MAX_RATE_WAIT) {
                Log::info('Bespoke AI rate limited; waiting', $context + ['seconds' => $wait, 'attempt' => $attempt + 1]);
                (self::$sleeper ?? fn (float $s) => usleep((int) ($s * 1_000_000)))($wait);

                return self::request($key, $base, $model, $payload, $attempt + 1);
            }
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

            return ['message' => null, 'retry' => $retry, 'next' => $next];
        }

        $message = $response->json('choices.0.message');
        $hasCalls = is_array($message) && ! empty($message['tool_calls']);
        if (! is_array($message) || (self::text($message) === null && ! $hasCalls)) {
            Log::warning('Bespoke AI empty reply', $context + [
                'finish' => $response->json('choices.0.finish_reason'),
                'message' => Str::limit(self::errorMessage($response), 300),
            ]);

            return ['message' => null, 'retry' => false, 'next' => false];
        }

        return ['message' => $message, 'retry' => false, 'next' => false];
    }

    /** Seconds the provider asked us to wait, from the header or its message. */
    private static function retryAfter(Response $response): ?float
    {
        $header = $response->header('Retry-After');
        if (is_string($header) && is_numeric(trim($header))) {
            return max(0.5, (float) trim($header));
        }
        if (preg_match('/try again in ([0-9.]+)\s*(ms|s)\b/i', self::errorMessage($response), $m) === 1) {
            $value = (float) $m[1];

            return max(0.5, strtolower($m[2]) === 'ms' ? $value / 1000 : $value);
        }

        return 2.0;
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
