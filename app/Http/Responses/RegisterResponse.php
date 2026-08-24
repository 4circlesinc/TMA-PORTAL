<?php

namespace App\Http\Responses;

use App\Support\SafeIntended;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;

class RegisterResponse implements RegisterResponseContract
{
    public function toResponse($request)
    {
        SafeIntended::scrub();

        // Always the confirmation screen — never a stale intended asset URL
        // (e.g. /media/avatars/….jpg parked by a guest image request).
        $next = route('verification.notice');

        if ($request->wantsJson()) {
            return new JsonResponse(['redirect' => $next], 201);
        }

        return redirect()->to($next);
    }
}
