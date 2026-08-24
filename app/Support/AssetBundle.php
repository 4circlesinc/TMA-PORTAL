<?php

namespace App\Support;

/**
 * Swaps the shell's per-file asset tags for the built bundles.
 *
 * The shell keeps listing every stylesheet and script individually, that list
 * is the source of truth for load order, and editing it is still how you add
 * an asset. This rewrites those tags on the way out when a build exists, so
 * the ordering lives in one place and the browser still gets two requests
 * instead of a hundred and seventeen.
 *
 * No build, no rewrite: a fresh checkout or a local dev session with no
 * public/build serves the raw tags exactly as it always has. Nothing here is
 * required for the portal to work, which is the point, a broken or missing
 * build degrades to "slower", never to "blank page".
 *
 * @see scripts/build-assets.mjs, writes the manifest this reads.
 */
final class AssetBundle
{
    /**
     * Must stay in step with CSS_TAG/JS_TAG in scripts/build-assets.mjs, the
     * build reads the load order through these same shapes, so a tag either
     * side misses is a tag that silently stops being served.
     */
    private const CSS_TAG = '~^[ \t]*<link rel="stylesheet" href="css/([^"?]+)(?:\?[^"]*)?">[ \t]*$~m';

    private const JS_TAG = '~^[ \t]*<script src="js/([^"?]+)(?:\?[^"]*)?" defer></script>[ \t]*$~m';

    /** Rewritten shells, keyed by content hash. The regex work happens once. */
    private static array $rendered = [];

    private static ?array $manifest = null;

    private static bool $manifestLoaded = false;

    public static function apply(string $html): string
    {
        $manifest = self::manifest();

        if ($manifest === null) {
            return $html;
        }

        $key = md5($html);

        return self::$rendered[$key] ??= self::rewrite($html, $manifest);
    }

    private static function rewrite(string $html, array $manifest): string
    {
        $css = self::tag($html, self::CSS_TAG, $manifest['sources']['css'] ?? []);
        $js = self::tag($html, self::JS_TAG, $manifest['sources']['js'] ?? []);

        if ($css === null || $js === null) {
            // The shell lists assets the build has never seen, so the bundle is
            // stale. Serving it would drop whatever was just added; the raw
            // tags are always correct, only slower.
            return $html;
        }

        $html = self::replace($html, $js, sprintf(
            '  <script src="build/%s" defer></script>',
            $manifest['js'],
        ));

        return self::replace($html, $css, sprintf(
            '  <link rel="stylesheet" href="build/%s">',
            $manifest['css'],
        ));
    }

    /**
     * Locate the run of tags this bundle replaces.
     *
     * Returns null unless the shell's list matches the build's exactly —
     * same files, same order. Anything else means the two have drifted.
     *
     * @return array{0:int,1:int}|null Byte offsets of the first and last tag.
     */
    private static function tag(string $html, string $pattern, array $expected): ?array
    {
        if (! preg_match_all($pattern, $html, $matches, PREG_OFFSET_CAPTURE)) {
            return null;
        }

        $found = [];

        foreach ($matches[1] as $match) {
            // The shell loads a couple of files twice; the build de-duplicates,
            // so compare against the same de-duplicated order.
            if (! in_array($match[0], $found, true)) {
                $found[] = $match[0];
            }
        }

        if ($found !== $expected) {
            return null;
        }

        $first = $matches[0][0];
        $last = $matches[0][count($matches[0]) - 1];

        return [$first[1], $last[1] + strlen($last[0])];
    }

    /** @param array{0:int,1:int} $span */
    private static function replace(string $html, array $span, string $tag): string
    {
        return substr($html, 0, $span[0]).$tag.substr($html, $span[1]);
    }

    private static function manifest(): ?array
    {
        if (self::$manifestLoaded) {
            return self::$manifest;
        }

        self::$manifestLoaded = true;

        $path = public_path('build/manifest.json');

        if (! is_file($path)) {
            return self::$manifest = null;
        }

        $decoded = json_decode((string) file_get_contents($path), true);

        if (! is_array($decoded) || ! isset($decoded['css'], $decoded['js'], $decoded['sources'])) {
            return self::$manifest = null;
        }

        return self::$manifest = $decoded;
    }
}
