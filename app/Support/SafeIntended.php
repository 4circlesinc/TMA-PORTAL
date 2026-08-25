<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Intended URLs after login / register / verify.
 *
 * A guest request for an auth-gated asset (for example /media/avatars/….jpg)
 * parks that URL as url.intended. After register or verify, Fortify's
 * redirect()->intended() would then send the browser to the raw image —
 * which is what looked like "I signed up and landed on a photo URL".
 */
final class SafeIntended
{
    /**
     * Drop intended URLs that are not a normal portal page navigation.
     */
    public static function scrub(): void
    {
        $intended = session('url.intended');

        if (! is_string($intended) || $intended === '') {
            return;
        }

        if (self::isUnsafe($intended)) {
            session()->forget('url.intended');
        }
    }

    public static function isUnsafe(string $url): bool
    {
        $path = parse_url($url, PHP_URL_PATH);

        if (! is_string($path) || $path === '') {
            return true;
        }

        $path = strtolower($path);

        // Binary / media / storage, never a post-auth landing page.
        if (preg_match('#^/(media|storage|build|vendor)(/|$)#', $path)) {
            return true;
        }

        if (preg_match('#\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|mp3|mp4|webm|css|js|map|woff2?|ttf|eot)$#', $path)) {
            return true;
        }

        return false;
    }

    /**
     * Login page query string. Signing out uses ?from=logout so a 401 from
     * Settings cannot park that page as the post-login destination.
     */
    public static function captureFromLogin(Request $request): void
    {
        if ($request->query('from') === 'logout') {
            $request->session()->forget('url.intended');

            return;
        }

        $return = $request->query('return');
        if (! is_string($return) || $return === '' || ! str_starts_with($return, '/') || str_starts_with($return, '//')) {
            return;
        }

        if (self::isUnsafe($return)) {
            return;
        }

        $request->session()->put('url.intended', $return);
    }
}
