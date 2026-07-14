<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\SecurityPolicies;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminSecurityController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'isAdmin' => $this->isAdmin($request->user()),
            'signInPolicy' => SecurityPolicies::get('sign-in'),
            'securityPolicy' => SecurityPolicies::get('security'),
            'deviceSecurity' => SecurityPolicies::get('device'),
        ]);
    }

    public function update(Request $request, string $section): JsonResponse
    {
        abort_unless(in_array($section, SecurityPolicies::SECTIONS, true), 404);
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can change security policies.');

        $value = match ($section) {
            'sign-in' => $request->validate([
                'minLength' => ['required', 'integer', 'between:8,64'],
                'numbersRequired' => ['required', 'integer', 'between:0,4'],
                'specialRequired' => ['required', 'integer', 'between:0,4'],
                'requireMfa' => ['required', 'boolean'],
            ]),
            'security' => $request->validate([
                'trustedDomains' => ['present', 'string', 'max:2000'],
                'autoRemediation' => ['required', 'array'],
                'autoRemediation.impossibleTravel' => ['required', 'boolean'],
                'autoRemediation.downloadTrend' => ['required', 'boolean'],
                'autoRemediation.ipCountChange' => ['required', 'boolean'],
                'autoRemediation.failedSignIns' => ['required', 'boolean'],
                'autoRemediation.suspiciousIp' => ['required', 'boolean'],
            ]),
            'device' => $request->validate([
                'defaultMode' => ['required', Rule::in(['standard', 'secure'])],
                'selfDestruct' => ['required', Rule::in(['Never', 'After 1 day offline', 'After 7 days offline', 'After 30 days offline'])],
            ]),
        };

        SecurityPolicies::put($section, $value, $request->user()->id);

        return response()->json(['status' => 'ok']);
    }

    private function isAdmin(User $user): bool
    {
        return $user->account_type === 'Administrator';
    }
}
