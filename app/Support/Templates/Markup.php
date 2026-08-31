<?php

namespace App\Support\Templates;

use Illuminate\Support\HtmlString;

/**
 * The little language an administrator writes a template in.
 *
 *   {{name}}                    a placeholder, filled at send time
 *   {{#name}}Hi {{name}},{{/name}}   only when the value is there
 *   {{^name}}Hello,{{/name}}         only when it is not
 *
 * A field the email shows as text (subject, title, lead…) is filled and
 * nothing more; the postcard escapes it. A field the email renders as HTML
 * (the body) also gets paragraphs from blank lines, bullets from "- " lines,
 * **bold**, [label](url) links, and bare links and addresses made clickable.
 * Placeholder values are escaped there, so a name with a "<" in it is shown,
 * not interpreted; a value given as an HtmlString is trusted markup the
 * caller built (a list of documents, a decision letter) and goes in as is.
 *
 * A placeholder the template does not know is left as written, so a typo is
 * visible in the preview rather than silently blank. Saving rejects them.
 */
class Markup
{
    private const TOKEN = '/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/';

    private const LINK_STYLE = 'color:#03a5e9;text-decoration:none;';

    /** Fill a text field: sections resolved, placeholders replaced verbatim. */
    public static function fill(string $text, array $vars): string
    {
        $text = self::sections($text, $vars);

        return (string) preg_replace_callback(self::TOKEN, function (array $m) use ($vars) {
            if (! array_key_exists($m[1], $vars)) {
                return $m[0];
            }

            return self::text($vars[$m[1]]);
        }, $text);
    }

    /** Render an HTML field: sections, placeholders (escaped), then the markup. */
    public static function html(string $text, array $vars): string
    {
        $text = self::sections($text, $vars);

        // Decided on the authored template, before any value is filled in, so
        // a "<" typed into somebody's name can never switch the mode.
        $isHtml = self::looksLikeHtml($text);

        // Trusted markup is parked behind tokens so the escaping and the
        // link-spotting below never touch it, then put back at the end.
        $raw = [];
        $text = (string) preg_replace_callback(self::TOKEN, function (array $m) use ($vars, &$raw, $isHtml) {
            if (! array_key_exists($m[1], $vars)) {
                return $m[0];
            }
            $value = $vars[$m[1]];
            if ($value instanceof HtmlString) {
                $raw[] = $value->toHtml();

                // \x1A, not \x00: trim() strips NULs, and the paragraph pass
                // trims every line, which ate the marker and left its digit.
                return "\x1A".(count($raw) - 1)."\x1A";
            }

            // In an HTML-authored template the value lands inside markup, so
            // it must be escaped here; the little language escapes whole
            // lines later in inline() instead.
            return $isHtml ? e(self::text($value)) : self::text($value);
        }, $text);

        if ($isHtml) {
            return (string) preg_replace_callback(
                "/\x1A(\d+)\x1A/",
                fn (array $m) => $raw[(int) $m[1]] ?? '',
                self::sanitize($text),
            );
        }

        $paragraphs = preg_split("/\n[ \t]*\n/", str_replace(["\r\n", "\r"], "\n", trim($text))) ?: [];
        $html = '';

        foreach ($paragraphs as $paragraph) {
            $lines = array_values(array_filter(array_map('trim', explode("\n", $paragraph)), fn (string $l) => $l !== ''));
            if ($lines === []) {
                continue;
            }

            if (count($lines) === 1 && preg_match('/^\x1A\d+\x1A$/', $lines[0])) {
                // A trusted block (a letter body, a document list) stands on
                // its own; wrapping it in a <p> would nest block markup.
                $html .= $lines[0];
                continue;
            }

            $bullets = count(array_filter($lines, fn (string $l) => str_starts_with($l, '- '))) === count($lines);

            if ($bullets) {
                $html .= '<ul>'.implode('', array_map(
                    fn (string $l) => '<li>'.self::inline(substr($l, 2)).'</li>',
                    $lines,
                )).'</ul>';
            } else {
                $html .= '<p>'.implode('<br>', array_map(fn (string $l) => self::inline($l), $lines)).'</p>';
            }
        }

        return (string) preg_replace_callback("/\x1A(\d+)\x1A/", fn (array $m) => $raw[(int) $m[1]] ?? '', $html);
    }

    /**
     * A body written by the rich editor rather than in the little language.
     *
     * The editor only ever saves real tags; hand-typed text virtually never
     * contains one, and a stray "<" that is not a tag falls through to the
     * little language and is escaped exactly as before.
     */
    public static function looksLikeHtml(string $text): bool
    {
        return (bool) preg_match(
            '/<(p|div|br|strong|b|em|i|u|s|strike|ul|ol|li|a|font|span|blockquote)[\s\/>]/i',
            $text,
        );
    }

    /** Tags a rich-editor body may keep; everything else is unwrapped. */
    private const SAFE_TAGS = [
        'p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
        'ul', 'ol', 'li', 'a', 'font', 'span', 'blockquote',
    ];

    /** Inline style properties a span may carry (what the toolbar writes). */
    private const SAFE_STYLES = ['color', 'background-color', 'font-size', 'font-family'];

    /**
     * Reduce editor HTML to the tags and attributes the compose toolbar can
     * produce. Unknown elements are unwrapped (their text survives), event
     * handlers and scripts never survive, and links keep only http(s) and
     * mailto destinations — restyled to match the postcards' own links.
     */
    public static function sanitize(string $html): string
    {
        $doc = new \DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $doc->loadHTML(
            '<?xml encoding="utf-8"?><div id="tma-root">'.$html.'</div>',
            LIBXML_NOENT | LIBXML_NONET,
        );
        libxml_use_internal_errors($previous);

        $root = $doc->getElementById('tma-root');
        if (! $root) {
            return '';
        }

        self::scrub($root);

        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= $doc->saveHTML($child);
        }

        return $out;
    }

    private static function scrub(\DOMElement $parent): void
    {
        foreach (iterator_to_array($parent->childNodes) as $node) {
            if ($node instanceof \DOMText) {
                continue;
            }

            if (! $node instanceof \DOMElement) {
                $parent->removeChild($node);

                continue;
            }

            $tag = strtolower($node->tagName);

            // Their content is the dangerous part, so they go whole.
            if (in_array($tag, ['script', 'style', 'iframe', 'object', 'embed', 'form', 'head', 'title'], true)) {
                $parent->removeChild($node);

                continue;
            }

            self::scrub($node);

            if (! in_array($tag, self::SAFE_TAGS, true)) {
                // Unwrap: the words stay, the unknown wrapper goes.
                while ($node->firstChild) {
                    $parent->insertBefore($node->firstChild, $node);
                }
                $parent->removeChild($node);

                continue;
            }

            foreach (iterator_to_array($node->attributes) as $attr) {
                $name = strtolower($attr->name);
                $keep = match (true) {
                    $tag === 'a' && $name === 'href' => (bool) preg_match('/^(https?:|mailto:)/i', trim($attr->value)),
                    $tag === 'font' && in_array($name, ['size', 'color', 'face'], true) => true,
                    $name === 'style' => false, // rebuilt below from the safe subset
                    default => false,
                };
                $style = $name === 'style' ? $attr->value : null;
                if (! $keep) {
                    $node->removeAttribute($attr->name);
                }
                if ($style !== null) {
                    $clean = self::safeStyle($style);
                    if ($clean !== '') {
                        $node->setAttribute('style', $clean);
                    }
                }
            }

            if ($tag === 'a') {
                $node->setAttribute('style', self::LINK_STYLE);
            }
        }
    }

    /** The declarations the toolbar writes, and nothing else. */
    private static function safeStyle(string $style): string
    {
        $kept = [];
        foreach (explode(';', $style) as $declaration) {
            [$property, $value] = array_pad(explode(':', $declaration, 2), 2, '');
            $property = strtolower(trim($property));
            $value = trim($value);
            if ($value !== ''
                && in_array($property, self::SAFE_STYLES, true)
                && ! preg_match('/url\s*\(|expression|javascript/i', $value)) {
                $kept[] = $property.':'.$value;
            }
        }

        return implode(';', $kept);
    }

    /**
     * Every placeholder named in the text, sections included.
     *
     * @return list<string>
     */
    public static function tokens(string $text): array
    {
        preg_match_all('/\{\{\s*[#^\/]?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/', $text, $m);

        return array_values(array_unique($m[1]));
    }

    /** Resolve {{#var}}…{{/var}} and {{^var}}…{{/var}}, innermost first. */
    private static function sections(string $text, array $vars): string
    {
        $pattern = '/\{\{\s*([#^])\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}((?:(?!\{\{\s*[#^]\s*\2\s*\}\}).)*?)\{\{\s*\/\s*\2\s*\}\}/s';

        for ($i = 0; $i < 50; $i++) {
            $next = preg_replace_callback($pattern, function (array $m) use ($vars) {
                $present = self::truthy($vars[$m[2]] ?? null);

                return ($m[1] === '#') === $present ? $m[3] : '';
            }, $text);

            if ($next === null || $next === $text) {
                break;
            }
            $text = $next;
        }

        return $text;
    }

    private static function truthy(mixed $value): bool
    {
        if ($value instanceof HtmlString) {
            return trim($value->toHtml()) !== '';
        }
        if (is_bool($value)) {
            return $value;
        }
        if (is_string($value)) {
            return trim($value) !== '';
        }
        if (is_array($value)) {
            return $value !== [];
        }
        if (is_numeric($value)) {
            return (float) $value !== 0.0;
        }

        return $value !== null;
    }

    private static function text(mixed $value): string
    {
        if ($value instanceof HtmlString) {
            return $value->toHtml();
        }
        if (is_bool($value)) {
            return $value ? '1' : '';
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('j M Y');
        }

        return (string) $value;
    }

    /** One line of body text: escaped, then bold, links and bare addresses. */
    private static function inline(string $line): string
    {
        $s = e($line);
        $s = (string) preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $s);
        $s = (string) preg_replace(
            '/\[([^\]]+)\]\(([^)\s]+)\)/',
            '<a href="$2" style="'.self::LINK_STYLE.'">$1</a>',
            $s,
        );

        // Bare links and addresses, but only outside the anchors just made.
        $parts = preg_split('/(<a\b[^>]*>.*?<\/a>)/s', $s, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$s];
        foreach ($parts as $i => $part) {
            if ($i % 2 === 1) {
                continue;
            }
            $part = (string) preg_replace(
                '/(?<![\w"=\/])(https?:\/\/[^\s<]+?)(?=[.,;:!?)]*(?:\s|$))/',
                '<a href="$1" style="'.self::LINK_STYLE.'">$1</a>',
                $part,
            );
            $part = (string) preg_replace(
                '/(?<![\w@.\/])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)(?![\w\/])/',
                '<a href="mailto:$1" style="'.self::LINK_STYLE.'">$1</a>',
                $part,
            );
            $parts[$i] = $part;
        }

        return implode('', $parts);
    }
}
