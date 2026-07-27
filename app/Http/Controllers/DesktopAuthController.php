<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Sign-in handoff for the macOS desktop app.
 *
 * Google refuses OAuth inside an embedded webview, so the app sends the whole
 * sign-in to the user's real browser and gets a session back. The exchange is
 * PKCE-shaped, and for the same reason PKCE exists: the reply arrives over the
 * `tmaportal://` URL scheme, which any other app on the machine could also
 * register. So the browser only ever carries a token, and the token is worth
 * nothing without the verifier, which never leaves the app.
 *
 *   app                          browser                        server
 *   ---                          -------                        ------
 *   verifier = random            /auth/desktop/start?challenge=…  remember challenge,
 *   challenge = sha256(verifier) → sign in (any method) …         intend /finish
 *                                /auth/desktop/finish           → mint token, bound
 *                                                                 to user + challenge
 *   ← tmaportal://auth?token=…
 *   /auth/desktop/claim?token=…&verifier=…                      → verify, log in
 */
class DesktopAuthController extends Controller
{
    /** How long the browser has to finish signing in. */
    private const CHALLENGE_TTL = 900;

    /** How long the app has to redeem the token once issued. */
    private const TOKEN_TTL = 120;

    private const SCHEME = 'tmaportal';

    /**
     * Entry point, opened in the system browser by the desktop app.
     *
     * Parks the challenge in the browser session and points `intended` at
     * finish(), so every sign-in path — password, Google, Microsoft, and the
     * two-factor challenge behind any of them — lands back here on success
     * without needing its own hook.
     */
    public function start(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'challenge' => ['required', 'string', 'size:43', 'regex:/^[A-Za-z0-9_-]+$/'],
            'provider' => ['nullable', 'string', 'in:google,microsoft'],
        ]);

        $request->session()->put('desktop.challenge', $validated['challenge']);
        $request->session()->put('desktop.started_at', now()->timestamp);
        $request->session()->put('url.intended', route('desktop.finish'));

        // Already signed in in this browser? Nothing to do but hand back.
        if ($request->user()) {
            return redirect()->route('desktop.finish');
        }

        if ($provider = $validated['provider'] ?? null) {
            return redirect()->route('social.redirect', ['provider' => $provider]);
        }

        return redirect()->route('login');
    }

    /**
     * Reached after a successful sign-in in the browser. Mints the one-time
     * token and bounces to the app.
     */
    public function finish(Request $request): Response|RedirectResponse
    {
        $challenge = $request->session()->pull('desktop.challenge');
        $startedAt = (int) $request->session()->pull('desktop.started_at', 0);

        if (! $challenge || $startedAt < now()->timestamp - self::CHALLENGE_TTL) {
            return redirect('/');
        }

        $token = Str::random(64);

        Cache::put("desktop-auth:{$token}", [
            'user_id' => $request->user()->getKey(),
            'challenge' => $challenge,
        ], self::TOKEN_TTL);

        return response($this->handoffPage($token));
    }

    /**
     * Redeemed by the app itself, in the app's own cookie jar. Proving
     * knowledge of the verifier is what separates the real app from anything
     * else that grabbed the `tmaportal://` URL.
     */
    public function claim(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'size:64'],
            'verifier' => ['required', 'string', 'min:43', 'max:128'],
        ]);

        $key = "desktop-auth:{$validated['token']}";
        $entry = Cache::pull($key); // single use, whether or not it verifies

        if (! $entry) {
            return redirect()->route('login')->with('social_error', 'That sign-in link has expired. Try again.');
        }

        $expected = rtrim(strtr(base64_encode(hash('sha256', $validated['verifier'], true)), '+/', '-_'), '=');

        if (! hash_equals($entry['challenge'], $expected)) {
            return redirect()->route('login')->with('social_error', 'That sign-in could not be verified.');
        }

        $user = User::find($entry['user_id']);

        if (! $user) {
            return redirect()->route('login')->with('social_error', 'That account is no longer available.');
        }

        Auth::login($user, true);
        $request->session()->regenerate();

        return redirect('/');
    }

    /**
     * The browser tab the user is left looking at. Custom-scheme navigation
     * has to come from a user gesture or an in-page assignment — a 302 to
     * `tmaportal://` is dropped by most browsers — so do it in script and
     * leave a button behind for when the automatic hop is blocked.
     */
    private function handoffPage(string $token): string
    {
        $url = e(self::SCHEME.'://auth?token='.$token);

        return <<<HTML
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Signed in</title>
        <style>
          body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
                 display: grid; place-content: center; min-height: 100vh; margin: 0;
                 text-align: center; gap: 16px; color: #1c1c1c; background: #fff; }
          h1 { font-size: 19px; margin: 0; }
          p { margin: 0; color: #6b6b6b; }
          a { display: inline-block; margin-top: 8px; padding: 10px 22px; border-radius: 8px;
              background: #1c1c1c; color: #fff; text-decoration: none; font-size: 14px; }
          @media (prefers-color-scheme: dark) {
            body { background: #141414; color: #f2f2f2; } p { color: #9a9a9a; }
            a { background: #f2f2f2; color: #141414; }
          }
        </style>
        </head>
        <body>
          <h1>You're signed in</h1>
          <p>Returning you to the desktop app.</p>
          <a href="{$url}">Open the app</a>
          <script>location.href = {$this->jsonUrl($token)};</script>
        </body>
        </html>
        HTML;
    }

    private function jsonUrl(string $token): string
    {
        return json_encode(self::SCHEME.'://auth?token='.$token, JSON_UNESCAPED_SLASHES);
    }
}
