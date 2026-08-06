<?php

namespace App\Support;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Http\Response;

/**
 * Serves the SPA shell with the signed-in account's capabilities baked in.
 *
 * The shell is one static file shared by every account type, so the role-gated
 * rows (Overview, Client hub, Email, Feed, Users, Templates) can't be decided
 * until the browser knows who is reading. portal-access.js used to hold them
 * with `visibility:hidden` until /me answered — which reserved their space and
 * painted a sidebar with six blank gaps in it for the length of a round trip.
 *
 * Handing the capabilities over in the document removes the round trip: the
 * nav is right in the first paint, with no gap and no flash of staff tooling a
 * client may not use. /me still arrives and re-applies, so this is a head
 * start, never the authority.
 *
 * Safe to inline per-account data here only because the shell is served
 * no-store (see headers below) — it is never written to a shared cache.
 *
 * This is presentation only. Every capability is enforced again on the server;
 * see {@see Role}.
 */
final class PortalShell
{
    /**
     * Never cache the shell: it embeds both the menu and, now, the reader's
     * capabilities. A stored copy would serve one account's menu to the next.
     */
    private const HEADERS = [
        'Content-Type' => 'text/html; charset=UTF-8',
        'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma' => 'no-cache',
        'Expires' => '0',
    ];

    /**
     * The script tag the boot data must land in front of — portal-access.js
     * reads it the moment it runs, and it runs in <head> before the sidebar
     * parses. Anchoring to the consumer rather than to </head> means the two
     * cannot drift apart silently.
     */
    private const ANCHOR = '<script src="js/portal-access.js';

    public static function respond(string $path, ?User $user): Response
    {
        $html = @file_get_contents($path);

        if ($html === false) {
            abort(404);
        }

        return response(self::inject($html, $user), 200, self::HEADERS);
    }

    private static function inject(string $html, ?User $user): string
    {
        // No identity, no head start — let the browser hold the gated rows the
        // way it always has rather than assert an empty capability list, which
        // would strip the menu down to nothing.
        if ($user === null) {
            return $html;
        }

        $at = strpos($html, self::ANCHOR);

        if ($at === false) {
            return $html;
        }

        return substr($html, 0, $at).self::bootScript($user).substr($html, $at);
    }

    private static function bootScript(User $user): string
    {
        $json = json_encode(
            array_values(Role::capabilities($user)),
            JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR,
        );

        return '<script>window.TMABootCapabilities='.$json.';</script>'."\n  ";
    }
}
