<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Lets the "Confirm your email" screen notice verification that happened
 * on another device and reload into the next step without a manual refresh.
 */
class EmailVerificationStatusController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'verified' => $user !== null && $user->hasVerifiedEmail(),
        ]);
    }
}
