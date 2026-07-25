<?php

namespace App\Http\Responses;

use App\Support\StaySignedIn;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Laravel\Fortify\Fortify;

class LoginResponse implements LoginResponseContract
{
    public function toResponse($request)
    {
        if ($request->wantsJson()) {
            return new JsonResponse(['two_factor' => false]);
        }

        if ($request->session()->pull('stay_signed_in.pending') && StaySignedIn::shouldAsk($request)) {
            return redirect()->route('stay-signed-in.show');
        }

        $response = redirect()->intended(Fortify::redirects('login'));

        // Email form always posts remember=0|1 — either way the device was asked.
        if ($request->has('remember')) {
            $response->withCookie(StaySignedIn::promptedCookie($request));
        }

        return $response;
    }
}
