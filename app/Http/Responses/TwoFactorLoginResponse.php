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

        if (StaySignedIn::shouldAsk($request)) {
            return redirect()->route('stay-signed-in.show');
        }

        return redirect()->intended(Fortify::redirects('login'));
    }
}
