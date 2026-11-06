<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * Sign in with Apple answers with a cross-site form POST to the callback
 * (response_mode=form_post, required once name and email are asked for).
 *
 * A cross-site POST carries no SameSite=Lax cookie. Inside the web
 * middleware it would start an empty session, the callback would find no
 * OAuth state, and the Set-Cookie would overwrite the visitor's real session
 * on the way out. So this route is registered outside the web group
 * (bootstrap/app.php, withRouting then:), touches no session and sets no
 * cookie, and only re-sends Apple's fields as the ordinary GET callback. A
 * top-level GET does carry the session cookie, and SocialAuthController
 * takes it from there exactly as it does for Google and Microsoft.
 */
class AppleCallbackController extends Controller
{
    private const FIELDS = ['code', 'state', 'user', 'error'];

    public function __invoke(Request $request): RedirectResponse
    {
        $query = [];
        foreach (self::FIELDS as $field) {
            $value = $request->input($field);
            if (is_string($value) && $value !== '' && strlen($value) <= 4096) {
                $query[$field] = $value;
            }
        }

        $url = route('social.callback', ['provider' => 'apple']);

        // 303: the follow-up is a GET whatever the original method was.
        return new RedirectResponse($query ? $url.'?'.http_build_query($query) : $url, 303);
    }
}
