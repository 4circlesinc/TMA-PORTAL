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
     * Where a finished sign-in goes: the dashboard, always.
     *
     * Whatever page was parked is dropped: one a 401 sent to the sign-in
     * screen with ?return=, one a signed-out visit tried to open. Honouring
     * them reopened Account settings, or wherever the person happened to be,
     * which read as "it put me back where I was" rather than signing in.
     *
     * Two parked addresses are steps of a flow rather than a page, and still
     * continue: the app sign-in hand-off, and an invitation the person signed
     * in to accept. Only their path is ever returned, so a parked address can
     * never send anyone off this site.
     */
    public static function landing(): string
    {
        $intended = session()->pull('url.intended');

        if (! is_string($intended) || $intended === '') {
            return '/';
        }

        $host = parse_url($intended, PHP_URL_HOST);
        if (is_string($host) && strcasecmp($host, request()->getHost()) !== 0) {
            return '/';
        }

        $path = parse_url($intended, PHP_URL_PATH);
        if (! is_string($path)) {
            return '/';
        }

        $handOff = parse_url(route('desktop.finish'), PHP_URL_PATH);
        if ($path === $handOff || preg_match('#^/invite/[A-Za-z0-9]+$#', $path) === 1) {
            return $path;
        }

        return '/';
    }

    /**
     * The sign-in page no longer parks ?return=: signing in always opens the
     * dashboard (see landing()). Signing out also clears anything parked.
     */
    public static function captureFromLogin(Request $request): void
    {
        if ($request->query('from') === 'logout') {
            $request->session()->forget('url.intended');
        }
    }
}
