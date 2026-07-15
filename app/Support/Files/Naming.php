<?php

namespace App\Support\Files;

/**
 * File/folder name hygiene: strips path separators and control characters
 * (blocks directory traversal and unsafe names) and produces "Document (1).pdf"
 * style names when keeping both of a duplicate.
 */
class Naming
{
    public static function clean(string $name): string
    {
        // Drop any path components — names are logical, never a filesystem path.
        $name = str_replace(['/', '\\', "\0"], '', $name);
        // Remove control characters.
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '';
        // Collapse whitespace and trim leading dots/spaces.
        $name = trim($name);
        $name = ltrim($name, '. ');

        if (mb_strlen($name) > 255) {
            $name = mb_substr($name, 0, 255);
        }

        return $name;
    }

    public static function assertValid(string $name): string
    {
        $clean = self::clean($name);

        if ($clean === '' || in_array(strtolower($clean), ['.', '..'], true)) {
            throw new FileValidationException('Please enter a valid name.');
        }

        return $clean;
    }

    /**
     * Given a desired name and a predicate that reports whether a candidate is
     * already taken, return the first free name: "file.pdf" → "file (1).pdf".
     */
    public static function nextAvailable(string $name, callable $isTaken): string
    {
        if (! $isTaken($name)) {
            return $name;
        }

        $dot = strrpos($name, '.');
        if ($dot !== false && $dot > 0) {
            $base = substr($name, 0, $dot);
            $ext = substr($name, $dot); // includes the dot
        } else {
            $base = $name;
            $ext = '';
        }

        $n = 1;
        do {
            $candidate = $base.' ('.$n.')'.$ext;
            $n++;
        } while ($isTaken($candidate) && $n < 10000);

        return $candidate;
    }
}
