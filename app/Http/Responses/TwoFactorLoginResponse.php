<?php

namespace App\Http\Responses;

use App\Support\StaySignedIn;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\TwoFactorLoginResponse as TwoFactorLoginResponseContract;
use Laravel\Fortify\Fortify;

class TwoFactorLoginResponse implements TwoFactorLoginResponseContract
{
    public function toResponse($request)
    {
        if ($request->wantsJson()) {
            return new JsonResponse('', 204);
        }

        if ($redirect = StaySignedIn::afterAuthenticated($request)) {
            return $redirect;
        }

        return redirect()->intended(Fortify::redirects('login'));
    }
}
