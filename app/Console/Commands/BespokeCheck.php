<?php

namespace App\Console\Commands;

use App\Support\Bespoke\Bespoke;
use App\Support\Bespoke\Completions;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Reports exactly why Bespoke AI is not answering.
 *
 * Written because "I could not reach the language model" is one sentence for
 * a dozen distinct causes: no key, a revoked key, a model the host retired,
 * a base URL pointing at a host that never had that model, a per-minute token
 * limit, or a reply that came back empty. From the outside they are identical,
 * and production has no log the reader can see. This asks the host directly
 * and names the cause.
 */
class BespokeCheck extends Command
{
    protected $signature = 'bespoke:check {--say=Say the single word OK. : Prompt to send when the connection works}';

    protected $description = 'Verify the Bespoke AI model connection and report why it fails';

    public function handle(): int
    {
        $this->line('');
        $this->line('<options=bold>Configuration</>');

        if (! Bespoke::enabled()) {
            $this->warn('  ! FEATURE_BESPOKE is off; the assistant 404s for everyone.');
        } else {
            $this->info('  ✓ FEATURE_BESPOKE is on');
        }

        if (! Bespoke::configured()) {
            $this->error('  ✗ No API key. Set BESPOKE_AI_API_KEY (or OPENAI_API_KEY).');
            $this->line('    Without it the assistant answers from the local guide only.');

            return self::FAILURE;
        }

        $key = trim((string) config('services.bespoke.key'));
        $base = rtrim(trim((string) config('services.bespoke.base_url')), '/');
        $models = Completions::models();

        $this->info('  ✓ API key is set ('.strlen($key).' chars, starts '.substr($key, 0, 4).'…)');
        $this->line('    host:   '.$base);
        $this->line('    models: '.($models === [] ? '(none)' : implode(', ', $models)));

        if ($models === []) {
            $this->error('  ✗ BESPOKE_AI_MODEL is empty; there is nothing to call.');

            return self::FAILURE;
        }

        if (Str::startsWith($key, 'gsk_') && ! Str::contains($base, 'groq')) {
            $this->warn('  ! That looks like a Groq key, but the host is not Groq. Expect 401.');
        }
        if (Str::startsWith($key, 'sk-') && Str::contains($base, 'groq')) {
            $this->warn('  ! That looks like an OpenAI key, but the host is Groq. Expect 401.');
        }

        $this->line('');
        $this->line('<options=bold>Live call</>');

        $working = [];
        foreach ($models as $model) {
            if ($this->probe($key, $base, $model)) {
                $working[] = $model;
            }
        }

        $this->line('');
        if ($working === []) {
            $this->error('  ✗ No configured model answered. Readers get the fallback line.');
            $this->line('    Fix the cause above, or list a model this host actually serves.');

            return self::FAILURE;
        }

        $this->info('  ✓ Answering with: '.implode(', ', $working));
        if (count($working) < count($models)) {
            $this->warn('  ! Some models failed. They are tried in order, so keep a good one first.');
        }
        if (count($working) === 1 && count($models) === 1) {
            $this->warn('  ! Only one model is configured. If the host retires it the assistant goes quiet;');
            $this->line('    list a second, comma-separated, as a fallback.');
        }

        return self::SUCCESS;
    }

    /** One real request, reported in the host's own words. */
    private function probe(string $key, string $base, string $model): bool
    {
        $this->line('  '.$model);

        $ask = function (bool $modern) use ($key, $base, $model) {
            $budget = $modern ? ['max_completion_tokens' => 2000] : ['max_tokens' => 2000];

            return Http::withToken($key)->timeout(45)->acceptJson()->post($base.'/chat/completions', [
                'model' => $model,
                'messages' => [['role' => 'user', 'content' => (string) $this->option('say')]],
            ] + $budget);
        };

        try {
            $response = $ask(false);
            // Reasoning models refuse max_tokens and name the replacement, the
            // same handover Completions makes. Without it this reports a 400
            // against a model that actually works.
            if ($response->status() === 400
                && preg_match('/max_tokens|temperature/i', (string) $response->json('error.message')) === 1) {
                $response = $ask(true);
            }
        } catch (\Throwable $e) {
            $this->error('    ✗ Could not connect: '.$e->getMessage());
            $this->line('      The host is unreachable from here; check egress and the base URL.');

            return false;
        }

        if ($response->successful()) {
            $text = (string) ($response->json('choices.0.message.content') ?? '');
            $reason = (string) ($response->json('choices.0.finish_reason') ?? '');
            if (trim($text) === '') {
                $this->warn('    ! Answered, but with no text (finish_reason: '.($reason ?: 'none').').');
                $this->line('      A reasoning model can spend the whole budget thinking.');

                return false;
            }
            $this->info('    ✓ '.Str::limit(trim($text), 60));

            return true;
        }

        $status = $response->status();
        $code = (string) ($response->json('error.code') ?? '');
        $message = (string) ($response->json('error.message') ?? $response->body());
        $this->error('    ✗ HTTP '.$status.($code !== '' ? ' ('.$code.')' : ''));
        $this->line('      '.Str::limit(trim($message), 200));
        $this->line('      '.$this->hint($status, $code));

        return false;
    }

    /** What the reader of this output should actually go and do. */
    private function hint(int $status, string $code): string
    {
        return match (true) {
            $status === 401 => 'The key is wrong, revoked, or belongs to a different host. Reissue it.',
            $status === 403 => 'The key is valid but not entitled to this model. Check the plan.',
            $status === 404 || in_array($code, ['model_not_found', 'model_decommissioned'], true) => 'This host does not serve that model; it may have been retired. Pick a current one.',
            $status === 429 => 'Rate or quota limit. If it is billing rather than per-minute, topping up is the fix.',
            $status >= 500 => 'The host is having trouble. A second model on a second host covers this.',
            default => 'Unexpected; the message above is the host’s own.',
        };
    }
}
