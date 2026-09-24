<?php

namespace App\Support;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Companies\CompanyAccess;
use App\Support\Dashboard\HomeBoard;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Session;

/**
 * Serves the SPA shell with the signed-in account's capabilities baked in.
 *
 * The shell is one static file shared by every account type, so the role-gated
 * rows (Overview, Client hub, Email, Feed, Users, Templates) can't be decided
 * until the browser knows who is reading. portal-access.js used to hold them
 * with `visibility:hidden` until /me answered, which reserved their space and
 * painted a sidebar with six blank gaps in it for the length of a round trip.
 *
 * Handing the capabilities over in the document removes the round trip: the
 * nav is right in the first paint, with no gap and no flash of staff tooling a
 * client may not use. /me still arrives and re-applies, so this is a head
 * start, never the authority.
 *
 * On "/" the same script also starts the home board's one request, so the
 * data is on its way while the bundle is still downloading. See bootScript.
 *
 * Safe to inline per-account data here only because the shell is served
 * no-store (see headers below), it is never written to a shared cache.
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
     * The script tag the boot data must land in front of, portal-access.js
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

        // Bundles first, capabilities second: the rewrite leaves the
        // portal-access.js tag alone (it is the one script the shell loads
        // undeferred), so the anchor below is still there to find.
        return response(self::inject(AssetBundle::apply($html), $user), 200, self::HEADERS);
    }

    private static function inject(string $html, ?User $user): string
    {
        // No identity, no head start, let the browser hold the gated rows the
        // way it always has rather than assert an empty capability list, which
        // would strip the menu down to nothing.
        if ($user === null) {
            return $html;
        }

        $at = strpos($html, self::ANCHOR);

        if ($at === false) {
            return $html;
        }

        return substr($html, 0, $at).self::bootScript($user, self::bootsDashboard()).substr($html, $at);
    }

    /**
     * Only "/" boots into the Dashboard view (routeFromPath in dashboard.js
     * and the inline skeleton switch in the shell agree on that), so only
     * "/" gets the board's request started early. Every other entry path
     * would be paying for a payload its view never reads.
     */
    private static function bootsDashboard(): bool
    {
        $path = rtrim((string) request()->getPathInfo(), '/');

        return $path === '';
    }

    private static function bootScript(User $user, bool $dashboard): string
    {
        $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR;
        $json = json_encode(array_values(Role::capabilities($user)), $flags);

        // Who the shell was served to, so anything a view caches per-tab can
        // be discarded the moment a different account is in it. Sign-out does
        // not clear sessionStorage, so without this the mailbox's warm start
        // would paint the previous reader's inbox for a frame, see
        // readMailCache() in email.js. It is the account's own id, which it
        // can read from /me anyway.
        $cipReach = CipAccess::canReach($user) ? 'true' : 'false';
        $provider = CipAccess::isProviderContact($user) ? 'true' : 'false';
        $spAdmin = Role::isServiceProviderAdmin($user) ? 'true' : 'false';
        $firm = Role::isServiceProviderAdmin($user) ? CompanyAccess::homeCompany($user) : null;
        $firmJson = json_encode(
            $firm ? ['id' => $firm->uid, 'name' => $firm->name] : null,
            $flags,
        );
        // Whether this reader is an administrator, before /me has answered.
        // The Workflows comment tabs need it at mount: an administrator whose
        // identity had not arrived yet asked the server for their OWN threads,
        // and a firm-wide reader who is on none of them saw an empty page.
        $admin = Role::isAdmin($user) ? 'true' : 'false';
        $bespoke = (bool) config('services.bespoke.enabled') ? 'true' : 'false';
        $token = json_encode((string) Session::token(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

        // CSRF for shell sign-out (static HTML has no Blade @csrf). Capabilities
        // plus CIP reach so provider contacts keep the Applications nav without
        // holding clients.view.
        return '<script>window.TMABootCapabilities='.$json.';'
            .'window.TMABootUserId='.(int) $user->id.';'
            .'window.TMABootCipReach='.$cipReach.';'
            .'window.TMABootProviderContact='.$provider.';'
            .'window.TMABootServiceProviderAdmin='.$spAdmin.';'
            .'window.TMABootProviderCompany='.$firmJson.';'
            .'window.TMABootIsAdmin='.$admin.';'
            .'window.TMABootBespoke='.$bespoke.';'
            .'window.TMACsrfToken='.$token.';'
            .($dashboard ? self::homeHeadStart($user, $flags) : '')
            .'</script>'."\n  "
            .self::lockdownTag($user);
    }

    /**
     * Casual-copy friction for everyone except administrators.
     *
     * Blocks dragging images out of the page and the browser's own context
     * menu; see public/js/ui-lockdown.js for what that is and is not worth.
     * An administrator gets nothing, which is the developer's way back to a
     * normal page: Role::ADMINISTRATOR is the top of the matrix and holds
     * every capability by definition, so there is no capability that could
     * express "may bypass this" — the absence of the script is the bypass.
     *
     * Emitted here rather than written into dashboard.html because
     * AssetBundle::tag() abandons the whole bundle rewrite unless the shell's
     * script list matches the build manifest exactly. A raw tag added to the
     * shell would degrade every account to ~117 requests with no error. This
     * one is undeferred and outside the bundler's regex (it matches only
     * `js/…` tags that carry `defer`), so it cannot join the bundle and
     * cannot break it.
     */
    private static function lockdownTag(User $user): string
    {
        if (Role::isAdmin($user)) {
            return '';
        }

        return '<script src="js/ui-lockdown.js?v=2"></script>'."\n  ";
    }

    /**
     * The home board's requests, started from <head>.
     *
     * The dashboard used to ask for its board only once the whole bundle had
     * downloaded, parsed and mounted, a few hundred milliseconds on a good
     * day and a second or more on a phone. This runs at parse, before the
     * first stylesheet has landed, so by the time portal-home.js mounts the
     * answer is usually already here. loadHomeBoard() takes a promise when
     * the URL is the one it would have asked for, and ignores it otherwise,
     * which is why each URL is written out beside its fetch rather than left
     * to be guessed. Two requests, not one: the file rows are the page's
     * largest text and cost as much as the other seven tiles together, so
     * they travel on their own worker rather than queue behind them (see
     * HomeBoard). Nothing here is the authority: the board's timer and live
     * signals refetch exactly as before.
     */
    private static function homeHeadStart(User $user, int $flags): string
    {
        $board = json_encode(HomeBoard::bootUrl($user), $flags);
        $files = json_encode(HomeBoard::bootFilesUrl(), $flags);
        $init = '{credentials:"same-origin",headers:{Accept:"application/json","X-Requested-With":"XMLHttpRequest"}}';

        return 'window.TMABootHomeUrl='.$board.';'
            .'window.TMABootHome=fetch('.$board.','.$init.');'
            .'window.TMABootHomeFilesUrl='.$files.';'
            .'window.TMABootHomeFiles=fetch('.$files.','.$init.');';
    }
}
