<?php

namespace App\Http\Controllers;

use App\Models\PrivacyRequest;
use App\Support\Privacy\AccountErasure;
use App\Support\Privacy\PersonalDataExport;
use App\Support\Privacy\PrivacyPolicy;
use App\Support\Privacy\ProcessingRestriction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class PrivacyRightsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'restricted' => $user->processing_restricted_at !== null,
            'policyVersion' => PrivacyPolicy::VERSION,
            'acceptedAt' => optional($user->privacy_policy_accepted_at)->toIso8601String(),
        ]);
    }

    public function export(Request $request): JsonResponse
    {
        $user = $request->user();

        PrivacyRequest::query()->create([
            'user_id' => $user->id,
            'type' => PrivacyRequest::TYPE_EXPORT,
            'status' => PrivacyRequest::STATUS_COMPLETED,
            'detail' => ['policyVersion' => PrivacyPolicy::VERSION],
        ]);

        return response()->json(PersonalDataExport::for($user), 200, [
            'Content-Disposition' => 'attachment; filename="tma-personal-data.json"',
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    }

    public function erase(Request $request): JsonResponse
    {
        $request->validate([
            'confirm' => ['required', 'in:DELETE'],
        ], [
            'confirm.in' => 'Type DELETE to confirm you want to erase this account.',
        ]);

        $userId = $request->user()->id;
        $result = AccountErasure::run($request->user());

        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        AccountErasure::forgetSignOutTrail($userId);

        return response()->json($result);
    }

    public function restrict(Request $request): JsonResponse
    {
        ProcessingRestriction::restrict($request->user());

        return response()->json(['restricted' => true]);
    }

    public function liftRestriction(Request $request): JsonResponse
    {
        ProcessingRestriction::lift($request->user());

        return response()->json(['restricted' => false]);
    }
}
