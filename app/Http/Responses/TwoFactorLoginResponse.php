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

        if ($request->session()->pull('stay_signed_in.pending') && StaySignedIn::shouldAsk($request)) {
            return redirect()->route('stay-signed-in.show');
        }

        $response = redirect()->intended(Fortify::redirects('login'));

        $remembered = method_exists($request, 'remember') && $request->remember();
        $markPrompted = $request->session()->pull('stay_signed_in.mark_prompted', false);

        if ($remembered || $markPrompted) {
            $response->withCookie(StaySignedIn::promptedCookie($request));
        }

        return $response;
    }
}
