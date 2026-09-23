<?php

namespace App\Support\Bespoke;

use App\Models\BespokeAttachment;
use Illuminate\Support\Collection;

/**
 * "Crop this into a 2×2" read straight from the reader's own words.
 *
 * The model normally calls resize_photo, but a photo is the one thing a
 * reader hands over and watches for: when the provider is rate-limited or
 * down, the FAQ used to answer a dropped photo with the size requirements
 * instead of cropping it. This reads the intent here, so the crop happens
 * on the reader's words alone and the model only has to describe it.
 */
final class PhotoIntent
{
    /** Verbs that mean "act on the picture", not "tell me about photos". */
    private const VERBS = [
        'crop', 'cut', 'trim', 'resize', 'size', 'make', 'turn', 'convert',
        'extract', 'pull', 'take', 'fix', 'prepare', 'format', 'square',
    ];

    /** The thing being asked for. */
    private const NOUNS = [
        '2x2', '2 x 2', '2×2', 'passport photo', 'passport picture', 'passport size',
        'headshot', 'head shot', 'photo', 'picture', 'portrait', 'square',
    ];

    /**
     * Does this ask for a photo to be made, rather than asking what the
     * photo rules are? Returns false for pure questions ("what size…").
     */
    public static function asksForCrop(string $query): bool
    {
        $q = mb_strtolower(trim($query));
        if ($q === '') {
            return false;
        }

        // A question about the requirements is not a request to crop.
        if (preg_match('/^(what|which|how big|how large|whats|what\'s)\b/', $q) === 1
            && ! preg_match('/\b(crop|resize|make it|turn it|convert)\b/', $q)) {
            return false;
        }

        $hasVerb = false;
        foreach (self::VERBS as $verb) {
            if (preg_match('/\b'.preg_quote($verb, '/').'\w*\b/u', $q) === 1) {
                $hasVerb = true;
                break;
            }
        }
        if (! $hasVerb) {
            return false;
        }

        foreach (self::NOUNS as $noun) {
            if (str_contains($q, $noun)) {
                return true;
            }
        }

        // "crop it", "resize this" with a photo attached is unambiguous
        // enough on its own; the caller only asks when one is attached.
        return preg_match('/\b(crop|resize|trim|square)\w*\s+(it|this|that|the (image|file|scan|attachment))\b/u', $q) === 1;
    }

    /**
     * The attachment a crop request means: the one the reader named, else
     * the most recent image, else the most recent PDF.
     *
     * @param  Collection<int, BespokeAttachment>  $attachments
     */
    public static function target(Collection $attachments, string $query): ?BespokeAttachment
    {
        $usable = $attachments
            ->filter(fn (BespokeAttachment $a) => ($a->isImage() || $a->isPdf()) && $a->kind !== 'derived')
            ->values();

        if ($usable->isEmpty()) {
            return null;
        }

        $q = mb_strtolower($query);
        foreach ($usable as $a) {
            $name = mb_strtolower((string) $a->name);
            if ($name !== '' && str_contains($q, $name)) {
                return $a;
            }
        }

        $image = $usable->last(fn (BespokeAttachment $a) => $a->isImage());

        return $image ?? $usable->last();
    }
}
