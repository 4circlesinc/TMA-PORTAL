<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use Illuminate\Support\Facades\URL;

/**
 * The picture a notification about an application shows: the main
 * applicant's face, the same one the worklist and the case chat draw.
 *
 * A message in a file's group chat, a status change, a comment on one of its
 * documents: the reader thinks of the file as the family it belongs to, so
 * the picture is theirs, not whoever happened to press the button. Only a
 * one-on-one conversation shows the sender (App\Support\Notifications\
 * MessagePush decides which).
 *
 * The face is the main applicant's own photo on the application, then the
 * client's, then a live portal login's. With none of those it is their
 * initials, drawn here, so the picture still says whose file it is rather
 * than falling back to the sender's face.
 */
final class ApplicantFace
{
    /** How long the initials link in a phone notification lasts. */
    public const DAYS = 3;

    private const SIZE = 256;

    /** The tile colour when the client record has none of its own. */
    private const BRAND = '#136DA0';

    /** The applicant's photo, as a portal address, or null when there is none. */
    public static function photoUrl(CipApplication $application): ?string
    {
        $application->loadMissing(['people', 'client.user']);

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $client = $application->client;

        foreach ([
            $main?->photo_url,
            $client?->photo_url,
            $client && $client->hasLiveLogin() ? $client->user?->photoUrl() : null,
        ] as $url) {
            if (is_string($url) && $url !== '') {
                return $url;
            }
        }

        return null;
    }

    /** A signed link to the initials tile, for a device that cannot sign in. */
    public static function initialsUrl(CipApplication $application): string
    {
        return URL::temporarySignedRoute(
            'cip.applicant-initials.push',
            now()->addDays(self::DAYS),
            ['uuid' => $application->uuid],
        );
    }

    /** "VF" for Vernon Francis; one letter for a single name; "?" for none. */
    public static function initials(CipApplication $application): string
    {
        $application->loadMissing(['people', 'client']);

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $name = trim((string) ($main?->fullName() ?: ($application->client?->name ?? '')));
        $words = preg_split('/\s+/u', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        if ($words === []) {
            return '?';
        }

        $first = mb_substr($words[0], 0, 1);
        $last = count($words) > 1 ? mb_substr($words[count($words) - 1], 0, 1) : '';

        return mb_strtoupper($first.$last);
    }

    /**
     * The initials tile as PNG bytes: white letters on the client's own
     * colour (the one its initials tile uses in the portal), else the brand's.
     */
    public static function initialsPng(CipApplication $application): string
    {
        $application->loadMissing('client');

        $image = imagecreatetruecolor(self::SIZE, self::SIZE);
        [$r, $g, $b] = self::rgb((string) ($application->client?->initial_color ?: self::BRAND));
        imagefill($image, 0, 0, imagecolorallocate($image, $r, $g, $b));
        $white = imagecolorallocate($image, 255, 255, 255);

        $text = self::initials($application);
        $font = public_path('js/vendor/standard_fonts/LiberationSans-Bold.ttf');

        if (is_file($font) && function_exists('imagettftext')) {
            $size = mb_strlen($text) > 1 ? 96 : 112;
            $box = imagettfbbox($size, 0, $font, $text) ?: [0, 0, 0, 0, 0, 0, 0, 0];
            $width = $box[2] - $box[0];
            $height = $box[1] - $box[7];
            $x = (int) round((self::SIZE - $width) / 2 - $box[0]);
            $y = (int) round((self::SIZE - $height) / 2 - $box[7]);
            imagettftext($image, $size, 0, $x, $y, $white, $font, $text);
        } else {
            // No font on this server: the built-in one, small but legible.
            imagestring($image, 5, (int) (self::SIZE / 2 - 9 * mb_strlen($text) / 2), (int) (self::SIZE / 2 - 8), $text, $white);
        }

        ob_start();
        imagepng($image);
        imagedestroy($image);

        return (string) ob_get_clean();
    }

    /** @return array{0: int, 1: int, 2: int} */
    private static function rgb(string $hex): array
    {
        $hex = ltrim(trim($hex), '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0].$hex[0].$hex[1].$hex[1].$hex[2].$hex[2];
        }
        if (! preg_match('/^[0-9a-f]{6}$/i', $hex)) {
            $hex = ltrim(self::BRAND, '#');
        }

        return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
    }
}
