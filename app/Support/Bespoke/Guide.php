<?php

namespace App\Support\Bespoke;

use App\Models\User;
use Illuminate\Support\Str;

/**
 * The printed user guide, searchable. resources/bespoke/user-guide.json is
 * exported from docs/user-guide/guide_body.py, so the assistant quotes the
 * same copy the PDF carries. Sections about staff-only screens are kept
 * from readers who cannot open them.
 */
final class Guide
{
    /** Section title => capability the reader needs (null = staff only). */
    private const GATED = [
        'Users and People' => 'users.view',
        'Reporting' => 'settings.reporting',
        'Call Recordings' => 'callRecordings.view',
        'Inviting service providers' => null,
        'Email' => 'mail.use',
        'Workflows' => 'workflows.view',
        'Overview and desktop apps' => 'overview.view',
    ];

    private const CIP_SECTIONS = [
        'CIP Applications', 'Inviting service providers', 'Pre-Approval workflow',
        'Post-Approval workflow', 'Working a CIP file', 'Managing Records',
    ];

    /** @var list<array{title: string, paragraphs: list<string>}>|null */
    private static ?array $sections = null;

    /** @return list<array{title: string, paragraphs: list<string>}> */
    public static function sections(): array
    {
        if (self::$sections !== null) {
            return self::$sections;
        }

        $path = resource_path('bespoke/user-guide.json');
        $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
        $sections = is_array($data['sections'] ?? null) ? $data['sections'] : [];

        self::$sections = array_values(array_filter(array_map(function ($section) {
            if (! is_array($section) || ! is_string($section['title'] ?? null)) {
                return null;
            }
            $paragraphs = array_values(array_filter(
                is_array($section['paragraphs'] ?? null) ? $section['paragraphs'] : [],
                'is_string',
            ));

            return ['title' => $section['title'], 'paragraphs' => $paragraphs];
        }, $sections)));

        return self::$sections;
    }

    /**
     * @param  array<string, mixed>  $identity
     * @return list<array{title: string, paragraphs: list<string>}>
     */
    public static function visible(User $user, array $identity): array
    {
        return array_values(array_filter(self::sections(), function (array $section) use ($user, $identity) {
            $title = $section['title'];
            if (! $identity['cipEnabled'] && in_array($title, self::CIP_SECTIONS, true)) {
                return false;
            }
            if (in_array($title, self::CIP_SECTIONS, true) && ! ($identity['cipReach'] || Bespoke::can($user, 'clients.view'))) {
                return false;
            }
            if (! array_key_exists($title, self::GATED)) {
                return true;
            }
            $needs = self::GATED[$title];

            return $needs === null ? $identity['isStaff'] : Bespoke::can($user, $needs);
        }));
    }

    /**
     * Best-matching sections for a question, each trimmed to the
     * paragraphs that carry the terms.
     *
     * @param  array<string, mixed>  $identity
     * @return list<array{title: string, text: string}>
     */
    public static function search(User $user, array $identity, string $query, int $limit = 3): array
    {
        $terms = self::terms($query);
        if ($terms === []) {
            return [];
        }

        $scored = [];
        foreach (self::visible($user, $identity) as $section) {
            $title = mb_strtolower($section['title']);
            $score = 0;
            $hits = [];
            foreach ($terms as $term) {
                if (str_contains($title, $term)) {
                    $score += 6;
                }
            }
            foreach ($section['paragraphs'] as $i => $paragraph) {
                $low = mb_strtolower($paragraph);
                $paragraphScore = 0;
                foreach ($terms as $term) {
                    if (str_contains($low, $term)) {
                        $paragraphScore += strlen($term) > 4 ? 3 : 1;
                    }
                }
                if ($paragraphScore > 0) {
                    $score += $paragraphScore;
                    $hits[$i] = $paragraphScore;
                }
            }
            if ($score > 0) {
                $scored[] = ['score' => $score, 'section' => $section, 'hits' => $hits];
            }
        }

        usort($scored, fn (array $a, array $b) => $b['score'] <=> $a['score']);

        $out = [];
        foreach (array_slice($scored, 0, max(1, min(5, $limit))) as $entry) {
            $section = $entry['section'];
            arsort($entry['hits']);
            $keep = array_slice(array_keys($entry['hits']), 0, 8, true);
            sort($keep);
            $text = [];
            foreach ($keep as $i) {
                $text[] = $section['paragraphs'][$i];
            }
            if ($text === []) {
                $text = array_slice($section['paragraphs'], 0, 4);
            }
            $out[] = [
                'title' => $section['title'],
                'text' => Str::limit(implode("\n", $text), 1800, '…'),
            ];
        }

        return $out;
    }

    /** @return list<string> */
    private static function terms(string $query): array
    {
        $stop = ['the', 'a', 'an', 'is', 'are', 'how', 'do', 'i', 'to', 'my', 'me', 'what', 'where', 'can', 'you', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'this', 'that', 'with', 'about', 'does', 'be', 'was', 'were', 'please', 'tell', 'explain'];
        $words = preg_split('/[^\p{L}\p{N}-]+/u', mb_strtolower($query)) ?: [];
        $terms = [];
        foreach ($words as $word) {
            $word = trim($word, '-');
            if (strlen($word) < 2 || in_array($word, $stop, true) || in_array($word, $terms, true)) {
                continue;
            }
            $terms[] = $word;
        }

        return array_slice($terms, 0, 12);
    }
}
