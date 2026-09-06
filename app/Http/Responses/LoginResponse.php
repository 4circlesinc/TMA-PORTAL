<?php

namespace App\Http\Responses;

use App\Support\LoginSession;
use App\Support\SafeIntended;
use App\Support\StaySignedIn;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Laravel\Fortify\Fortify;

class LoginResponse implements LoginResponseContract
{
    public function toResponse($request)
    {
        SafeIntended::scrub();

        if ($user = $request->user()) {
            LoginSession::stamp($user);
        }

        if ($request->wantsJson()) {
            return new JsonResponse(['two_factor' => false]);
        }

        if ($redirect = StaySignedIn::afterAuthenticated($request)) {
            return $redirect;
        }

        return redirect()->intended(Fortify::redirects('login'));
    }
}
