<?php

namespace App\Http\Controllers;

use App\Support\AuthenticatorNudge;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthenticatorNudgeController extends Controller
{
    public function shown(Request $request): JsonResponse
    {
        AuthenticatorNudge::markShown($request->user());

        return response()->json(['status' => 'ok']);
    }
}
