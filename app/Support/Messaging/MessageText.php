<?php

namespace App\Support\Messaging;

/**
 * A message's text, for the places that show one line of it.
 *
 * In its bubble a message is laid out as it was typed: its line breaks kept,
 * *bold* and _italic_ drawn as such. A chat list row, a reply quote and a
 * notification show a single plain line, and there the marks would only be
 * stray asterisks and underscores, so they are taken out and the lines run
 * together. The stored text is never changed: this is how it is read out.
 */
final class MessageText
{
    /**
     * The same marks the bubble draws (see inlineMessageHtml in messages.js):
     * *bold*, **bold**, __bold__ and _italic_, opening at the start of the text or
     * after a space or an opening bracket or quote, and closing before
     * anything that is not a letter or a digit. So 2*3*4, snake_case_name
     * and a correction like *their are left as they are.
     */
    private const EMPHASIS = '/(^|[\s(\[{"\x{201c}\x{2018}\'])(\*\*|__|\*|_)(\S|\S.*?\S)\2(?![\p{L}\p{N}_*])/u';

    public static function plain(?string $body): string
    {
        $text = (string) $body;

        // Marks can sit inside marks (*bold _and italic_*), a level at a time.
        for ($i = 0; $i < 3; $i++) {
            $next = preg_replace_callback(
                self::EMPHASIS,
                // Marks around nothing but marks are punctuation, not emphasis.
                fn (array $m) => preg_match('/[^*_]/', $m[3]) ? $m[1].$m[3] : $m[0],
                $text,
            );

            if ($next === null || $next === $text) {
                break;
            }

            $text = $next;
        }

        return trim((string) preg_replace('/\s+/u', ' ', $text));
    }
}
