<?php

namespace App\Support\Bespoke;

/**
 * What Bespoke AI must not talk about: how the portal is built, secured,
 * hosted, or paid for, and what the assistant itself runs on.
 *
 * Three layers, because a prompt rule alone can be talked around: a
 * question on these topics is answered here with a fixed line and never
 * reaches the model; the prompt carries the rule for anything subtler;
 * and a reply that names internal technology is replaced before it is
 * shown. The refusal is one sentence, then an offer of what it can do.
 */
final class Confidential
{
    public const REFUSAL = 'That’s confidential, so I can’t share it. I can help with using the portal instead.';

    /** Questions about the making, running, securing, or cost of the portal, or about the assistant itself. */
    private const ASKS = [
        '/\b(built|made|developed|written|coded|created|programmed|designed|running|hosted|deployed)\s+(with|in|on|using|by)\b/i',
        '/\b(tech(nology)?\s*stack|framework|programming\s+language|source\s*code|code\s*base|repositor(y|ies)|github|gitlab)\b/i',
        '/\b(laravel|php|javascript|typescript|node\.?js|react|vue|python|kotlin|swift|electron|postgres(ql)?|mysql|sqlite|redis|nginx|apache|docker|kubernetes|aws|azure|google\s+cloud|cloudflare|vercel|heroku|digital\s*ocean|laravel\s+cloud)\b/i',
        '/\b(which|what)\s+(ai|llm|model|language\s+model|chatbot|engine)\s+(are\s+you|is\s+this|do\s+you\s+use|powers|runs)\b/i',
        '/\b(openai|chatgpt|gpt-?\d|gpt-?oss|anthropic|claude|gemini|llama|mistral|groq|copilot)\b/i',
        '/\b(system\s+prompt|your\s+(instructions|prompt|rules|guidelines|configuration|tools)|hidden\s+instructions|developer\s+message)\b/i',
        '/\b(api\s*keys?|secret\s*keys?|access\s+tokens?|credentials|environment\s+variables?|\.env\b|config(uration)?\s+files?|admin\s+password|database\s+password|root\s+password)\b/i',
        '/\b(how\s+much\s+(did|does|will)\s+(it|this|the\s+portal|the\s+system|the\s+site|the\s+app)\s+cost|cost\s+(to|of)\s+(build|create|develop|make|run|host|maintain)|development\s+cost|(portal|website|app|system)\s+(budget|price|pricing)|how\s+much\s+(was|were)\s+(paid|spent)|licen[cs]e\s+fee)\b/i',
        '/\b(what\s+(kind|type|sort|level)\s+of\s+security|security\s+(measures|setup|architecture|features|systems?|protocols?|controls|stack|layer)|how\s+secure\s+is|is\s+(this|the)\s+(portal|site|system|app)\s+secure|encrypt(ed|ion)?|firewall|pen(etration)?\s*test|vulnerabilit(y|ies)|exploit|hack(ed|ing)?|bypass|backdoor)\b/i',
        '/\b(server(s)?|data\s*cent(er|re)|where\s+is\s+(my|the|our)\s+data\s+(stored|kept|held)|storage\s+provider|backups?\s+(are|is)\s+(stored|kept))\b/i',
        '/\b(who\s+(built|made|developed|created|designed|coded)\s+(this|the)\s+(portal|site|system|app)|developer(s)?\s+of\s+(this|the)\s+portal|which\s+(company|agency|firm)\s+(built|made|developed))\b/i',
    ];

    /** Names that have no business in an answer, however the question was put. */
    private const LEAKS = [
        'laravel', 'php', 'postgres', 'postgresql', 'sqlite', 'redis', 'reverb', 'cloudflare', 'r2',
        'groq', 'openai', 'chatgpt', 'gpt-oss', 'gpt-4', 'gpt-5', 'llama', 'anthropic', 'claude', 'gemini',
        'electron', 'kotlin', 'vite', 'esbuild', 'playwright', 'phpunit', 'nginx', 'docker', 'kubernetes',
        'aws', 'azure', 'heroku', 'vercel', 'system prompt', 'api key', 'env file',
    ];

    public static function asks(string $query): bool
    {
        $q = trim($query);
        if ($q === '') {
            return false;
        }
        foreach (self::ASKS as $pattern) {
            if (preg_match($pattern, $q) === 1) {
                return true;
            }
        }

        return false;
    }

    public static function leaks(string $reply): bool
    {
        $low = mb_strtolower($reply);
        foreach (self::LEAKS as $term) {
            if (preg_match('/(?<![\p{L}\p{N}-])'.preg_quote($term, '/').'(?![\p{L}\p{N}-])/u', $low) === 1) {
                return true;
            }
        }

        return false;
    }
}
