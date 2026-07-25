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

        if (StaySignedIn::shouldAsk($request)) {
            StaySignedIn::markNeeded($request);

            return redirect()->route('stay-signed-in.show');
        }

        return redirect()->intended(Fortify::redirects('login'));
    }
}
