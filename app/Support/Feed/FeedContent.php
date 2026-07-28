<?php

namespace App\Support\Feed;

use App\Models\FeedHashtag;
use App\Models\Group;
use App\Models\User;
use App\Support\Access\Role;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Everything that happens to the text of a post or comment between the
 * composer and the database.
 *
 * Three jobs, in this order:
 *
 *  1. **Sanitise.** The composer produces rich text, so what arrives is HTML
 *     written by a browser we do not control. It is parsed and rebuilt against
 *     an allow-list — unknown elements are unwrapped, every attribute except a
 *     named few is dropped, and any URL that is not http/https/mailto is
 *     removed. Nothing else in the portal renders user HTML into another
 *     person's page, so this is the one place that has to be right.
 *  2. **Flatten.** `body_text` is the same content without markup, stored so
 *     search can match on it without stripping tags per row.
 *  3. **Extract.** @mentions and #hashtags are pulled out of the text and
 *     resolved to real records, so notifications and the topic index work off
 *     rows rather than off a LIKE against the body.
 *
 * There is no HTML purifier dependency in this project; adding one for this is
 * a bigger decision than it looks, so the allow-list below is deliberately
 * narrow — it permits what the composer can actually produce and nothing more.
 */
final class FeedContent
{
    /**
     * Elements the composer may produce. Anything else is unwrapped: its text
     * survives, its tag does not. Dropping the subtree instead would silently
     * lose what someone wrote.
     */
    private const ALLOWED_TAGS = [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
        'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
        'h1', 'h2', 'h3', 'h4', 'a', 'span', 'div',
    ];

    /**
     * Elements whose entire subtree is discarded rather than unwrapped.
     *
     * Unwrapping a <script> would leave its source as visible text, and
     * unwrapping <style> would dump CSS into the post. Neither is content.
     */
    private const STRIPPED_SUBTREES = [
        'script', 'style', 'iframe', 'object', 'embed', 'form',
        'input', 'button', 'select', 'textarea', 'link', 'meta',
    ];

    /** tag => the attributes it may keep. Everything else is removed. */
    private const ALLOWED_ATTRIBUTES = [
        'a' => ['href', 'title'],
        // The composer marks a mention as <span data-mention="user:12"> or
        // <span data-mention="group:{uuid}">, and a hashtag as
        // <span data-hashtag="{tag}">, so the renderer can make them clickable
        // without re-parsing the text.
        'span' => ['data-mention', 'data-hashtag', 'class'],
        'code' => ['class'],
        'pre' => ['class'],
    ];

    /** Only these class names survive; a free-form class is a styling hole. */
    private const ALLOWED_CLASSES = [
        'tma-feed-mention', 'tma-feed-hashtag', 'tma-feed-code',
    ];

    /** URL schemes a link may use. */
    private const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

    /** Longest body we store, after sanitising. */
    public const MAX_BODY_LENGTH = 100000;

    /* ── Sanitising ───────────────────────────────────────────────── */

    /**
     * Rebuild untrusted HTML against the allow-list.
     *
     * Returns an empty string when nothing survives, so a caller can treat
     * "wrote only a <script>" the same as "wrote nothing".
     */
    public static function sanitise(?string $html): string
    {
        $html = trim((string) $html);

        if ($html === '') {
            return '';
        }

        $html = Str::limit($html, self::MAX_BODY_LENGTH, '');

        $doc = new DOMDocument;

        // Parse as a fragment inside a known wrapper. The XML declaration
        // forces UTF-8 handling — without it DOMDocument assumes ISO-8859-1
        // and mangles every accented character and emoji.
        $previous = libxml_use_internal_errors(true);
        $loaded = $doc->loadHTML(
            '<?xml encoding="UTF-8"?><div id="tma-feed-root">'.$html.'</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NONET
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        if (! $loaded) {
            // Unparseable markup is treated as plain text rather than trusted.
            return self::plainToHtml(strip_tags($html));
        }

        $xpath = new DOMXPath($doc);
        $root = $xpath->query('//*[@id="tma-feed-root"]')->item(0);

        if (! $root instanceof DOMElement) {
            return '';
        }

        self::cleanNode($root);

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child);
        }

        return trim($out);
    }

    /**
     * Walk one node's children, cleaning each. Iterated over a snapshot of the
     * child list because the walk removes and replaces nodes as it goes, and a
     * live DOMNodeList would skip siblings when one is taken out.
     */
    private static function cleanNode(DOMNode $node): void
    {
        $children = iterator_to_array($node->childNodes);

        foreach ($children as $child) {
            if ($child instanceof DOMElement) {
                self::cleanElement($child);

                continue;
            }

            // Text stays; comments and processing instructions go.
            if ($child->nodeType !== XML_TEXT_NODE) {
                $node->removeChild($child);
            }
        }
    }

    private static function cleanElement(DOMElement $el): void
    {
        $tag = strtolower($el->nodeName);

        if (in_array($tag, self::STRIPPED_SUBTREES, true)) {
            $el->parentNode?->removeChild($el);

            return;
        }

        // Clean the inside first: an unwrapped element's children are about to
        // be spliced into its parent, and they must already be safe.
        self::cleanNode($el);

        if (! in_array($tag, self::ALLOWED_TAGS, true)) {
            self::unwrap($el);

            return;
        }

        self::filterAttributes($el, $tag);
    }

    /** Replace an element with its own children, keeping the text. */
    private static function unwrap(DOMElement $el): void
    {
        $parent = $el->parentNode;

        if (! $parent) {
            return;
        }

        while ($el->firstChild) {
            $parent->insertBefore($el->firstChild, $el);
        }

        $parent->removeChild($el);
    }

    private static function filterAttributes(DOMElement $el, string $tag): void
    {
        $allowed = self::ALLOWED_ATTRIBUTES[$tag] ?? [];

        // Snapshot for the same reason as cleanNode(): removeAttribute()
        // mutates the live attribute list mid-iteration.
        foreach (iterator_to_array($el->attributes ?? []) as $attribute) {
            $name = strtolower($attribute->nodeName);

            if (! in_array($name, $allowed, true)) {
                $el->removeAttribute($attribute->nodeName);

                continue;
            }

            if ($name === 'href' && ! self::safeUrl($attribute->nodeValue)) {
                $el->removeAttribute($attribute->nodeName);
            }

            if ($name === 'class') {
                $kept = array_values(array_intersect(
                    preg_split('/\s+/', (string) $attribute->nodeValue) ?: [],
                    self::ALLOWED_CLASSES,
                ));

                $kept === []
                    ? $el->removeAttribute('class')
                    : $el->setAttribute('class', implode(' ', $kept));
            }
        }

        // Every surviving link leaves the portal in a new tab and carries
        // noopener, so a linked page cannot reach back through window.opener.
        if ($tag === 'a' && $el->hasAttribute('href')) {
            $el->setAttribute('rel', 'noopener noreferrer nofollow');
            $el->setAttribute('target', '_blank');
        }
    }

    /** Is this a URL we are willing to render as a link? */
    private static function safeUrl(?string $url): bool
    {
        $url = trim((string) $url);

        if ($url === '') {
            return false;
        }

        // A relative link inside the portal is fine.
        if (str_starts_with($url, '/') && ! str_starts_with($url, '//')) {
            return true;
        }

        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));

        return in_array($scheme, self::ALLOWED_SCHEMES, true);
    }

    /** Wrap plain text as paragraphs, escaping as it goes. */
    public static function plainToHtml(string $text): string
    {
        $paragraphs = preg_split('/\n{2,}/', trim($text)) ?: [];

        $html = '';
        foreach ($paragraphs as $paragraph) {
            if (trim($paragraph) === '') {
                continue;
            }
            $html .= '<p>'.nl2br(e($paragraph), false).'</p>';
        }

        return $html;
    }

    /* ── Flattening ───────────────────────────────────────────────── */

    /**
     * The searchable, notification-safe plain text of a body.
     *
     * Block elements become line breaks before tags are stripped, so a list
     * does not collapse into one run-on word.
     */
    public static function flatten(?string $html): string
    {
        $html = (string) $html;

        if ($html === '') {
            return '';
        }

        $html = preg_replace('/<(br|\/p|\/li|\/h[1-6]|\/blockquote|\/pre)[^>]*>/i', "\n", $html) ?? $html;
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/[ \t]+/', ' ', $text) ?? $text;
        $text = preg_replace('/\n{3,}/', "\n\n", $text) ?? $text;

        return trim($text);
    }

    /** A one-line preview for a notification title or an email subject. */
    public static function excerpt(?string $html, int $length = 140): string
    {
        $text = preg_replace('/\s+/', ' ', self::flatten($html)) ?? '';

        return Str::limit(trim($text), $length);
    }

    /* ── Extraction ───────────────────────────────────────────────── */

    /**
     * The tokens the composer marked as mentions.
     *
     * A token is "user:{id}" or "group:{uuid}" — people are addressed by
     * numeric id across this portal's APIs while groups carry a uuid, so the
     * marker names which it is rather than leaving the resolver to guess.
     *
     * The markers are authoritative: they carry the identity of whoever was
     * actually picked from the autocomplete. Bare text like "@sarah" is
     * deliberately *not* resolved by name, because two people can share a first
     * name and guessing would notify the wrong one.
     *
     * @return array<int, string> mention tokens, de-duplicated
     */
    public static function mentionTokens(?string $html): array
    {
        if (! $html || ! str_contains($html, 'data-mention')) {
            return [];
        }

        preg_match_all('/data-mention="([^"]+)"/', $html, $matches);

        return array_values(array_unique(array_filter($matches[1] ?? [])));
    }

    /**
     * Resolve mention tokens to the users and groups they name.
     *
     * Anything the actor could not otherwise reach is dropped rather than
     * resolved: mentioning someone must not become a way to confirm that an
     * account exists. Groups resolve only for staff, matching `groups.view`.
     *
     * @param  array<int, string>  $tokens
     * @return array{users: \Illuminate\Support\Collection<int, User>, groups: \Illuminate\Support\Collection<int, Group>}
     */
    public static function resolveMentions(array $tokens, User $actor): array
    {
        $userIds = [];
        $groupUuids = [];

        foreach ($tokens as $token) {
            if (str_starts_with($token, 'user:')) {
                $id = (int) substr($token, 5);
                if ($id > 0) {
                    $userIds[] = $id;
                }
            } elseif (str_starts_with($token, 'group:')) {
                $groupUuids[] = substr($token, 6);
            }
        }

        $users = $userIds === []
            ? collect()
            : User::query()
                ->whereIn('id', $userIds)
                ->where('status', User::STATUS_APPROVED)
                ->get();

        $groups = ($groupUuids === [] || ! Role::can($actor, 'groups.view'))
            ? collect()
            : Group::query()->whereIn('uuid', $groupUuids)->where('is_archived', false)->get();

        return ['users' => $users, 'groups' => $groups];
    }

    /**
     * Hashtags written in a body, as normalised tag strings.
     *
     * Reads the composer's `data-hashtag` markers *and* bare "#word" text, so
     * a tag typed into a plain paste is still indexed. The pattern requires a
     * letter to start, which keeps "#1" and colour hex values out of the index.
     *
     * @return array<int, string>
     */
    public static function hashtags(?string $html): array
    {
        if (! $html) {
            return [];
        }

        $tags = [];

        preg_match_all('/data-hashtag="([^"]+)"/', $html, $marked);
        foreach ($marked[1] ?? [] as $tag) {
            $tags[] = $tag;
        }

        // Bare tags are read from the flattened text so a '#' inside a URL or
        // an attribute value cannot be mistaken for a topic.
        preg_match_all('/(?:^|\s)#([\p{L}][\p{L}\p{N}_-]{0,79})/u', self::flatten($html), $bare);
        foreach ($bare[1] ?? [] as $tag) {
            $tags[] = $tag;
        }

        $normalised = [];
        foreach ($tags as $tag) {
            $clean = FeedHashtag::normalise($tag);
            if ($clean !== '' && mb_strlen($clean) <= 80) {
                $normalised[$clean] = $tag;
            }
        }

        return array_keys($normalised);
    }

    /**
     * Attach a post to its hashtags, creating tags that are new and keeping
     * each tag's usage counter in step.
     *
     * @param  array<int, string>  $tags  normalised tag strings
     */
    public static function syncHashtags(\App\Models\FeedPost $post, array $tags): void
    {
        $ids = [];

        foreach ($tags as $tag) {
            $hashtag = FeedHashtag::query()->firstOrCreate(
                ['tag' => $tag],
                ['display_tag' => $tag, 'posts_count' => 0],
            );

            $hashtag->forceFill(['last_used_at' => Carbon::now()])->save();
            $ids[] = $hashtag->id;
        }

        $changes = $post->hashtags()->sync($ids);

        // Recount rather than increment: sync() reports both sides of an edit,
        // and a counter nudged by a delta drifts the first time a post is
        // edited twice in a row.
        $touched = array_merge($changes['attached'] ?? [], $changes['detached'] ?? []);

        foreach (array_unique($touched) as $hashtagId) {
            $hashtag = FeedHashtag::find($hashtagId);
            $hashtag?->forceFill(['posts_count' => $hashtag->posts()->count()])->save();
        }
    }
}
