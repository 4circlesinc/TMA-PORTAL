<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * Parks a half-finished sign-in and sends the email code, the same session
 * keys Fortify uses for authenticator challenges so Stay signed in and
 * desktop handoff keep working afterwards.
 */
final class EmailTwoFactor
{
    public static function begin(Request $request, User $user): RedirectResponse
    {
        $request->session()->put([
            'login.id' => $user->getKey(),
            'login.remember' => $request->boolean('remember') || StaySignedIn::wantsRemember($request),
            'login.challenge' => 'email',
            'login.challenge_reason' => LoginChallenge::emailReason($user, $request),
        ]);

        EmailLoginCode::send($user, $request);

        return redirect()->route('login-code.show');
    }

    public static function user(Request $request): ?User
    {
        $id = $request->session()->get('login.id');

        return $id ? User::find($id) : null;
    }
}
