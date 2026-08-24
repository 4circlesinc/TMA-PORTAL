<?php

namespace App\Http\Responses;

use App\Support\SafeIntended;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\VerifyEmailResponse as VerifyEmailResponseContract;
use Laravel\Fortify\Fortify;

class VerifyEmailResponse implements VerifyEmailResponseContract
{
    public function toResponse($request)
    {
        SafeIntended::scrub();

        $home = Fortify::redirects('email-verification', '/auth/profile-setup');

        if ($request->wantsJson()) {
            return new JsonResponse(['redirect' => $home.'?verified=1'], 200);
        }

        return redirect()->to($home.(str_contains($home, '?') ? '&' : '?').'verified=1');
    }
}
