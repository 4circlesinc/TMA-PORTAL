<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Security\SecurityAlertPolicy;
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
            'alertSettings' => SecurityPolicies::get('alerts'),
            // What each alert means and when it fires, from the server. The
            // screen used to describe four events the portal cannot detect;
            // sourcing the copy here is what keeps it honest about the two it
            // can, see App\Support\Security\SecurityAlertPolicy.
            'alertEvents' => [
                [
                    'id' => 'newDevice',
                    'label' => 'Someone signs in from a device we haven’t seen',
                    'help' => 'The account holder is always told. This copies administrators in as well.',
                ],
                [
                    'id' => 'failedSignIns',
                    'label' => 'Repeated failed sign-ins on one account',
                    'help' => 'Sent once, when the count is reached inside an hour, not on every attempt after it.',
                ],
                [
                    'id' => 'impossibleTravel',
                    'label' => 'Sign-in from a new country too quickly',
                    'help' => 'Uses the Cloudflare country header. Off when that header is missing (local).',
                ],
                [
                    'id' => 'downloadTrend',
                    'label' => 'Unusual download volume',
                    'help' => 'Forty or more file downloads in ten minutes from one account.',
                ],
                [
                    'id' => 'ipCountChange',
                    'label' => 'Many networks used in a day',
                    'help' => 'Six or more distinct IP addresses on one account in 24 hours.',
                ],
                [
                    'id' => 'suspiciousIp',
                    'label' => 'One address attacking several accounts',
                    'help' => 'Failed sign-ins against three or more accounts from the same IP in an hour.',
                ],
                [
                    'id' => 'malwareDetected',
                    'label' => 'Malware blocked in an upload',
                    'help' => 'A vault file scanned as infected and its public links were revoked.',
                ],
            ],
            'failureWindowMinutes' => SecurityAlertPolicy::FAILURE_WINDOW_MINUTES,
        ]);
    }

    public function update(Request $request, string $section): JsonResponse
    {
        abort_unless(in_array($section, SecurityPolicies::SECTIONS, true), 404);
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can change security policies.');

        $value = match ($section) {
            'sign-in' => $this->signInRules($request),
            'security' => array_replace_recursive(
                SecurityPolicies::get('security'),
                $request->validate([
                    'trustedDomains' => ['present', 'string', 'max:2000'],
                    'callRecordingRetentionDays' => ['sometimes', 'integer', 'between:30,3650'],
                    'autoRemediation' => ['required', 'array'],
                    'autoRemediation.impossibleTravel' => ['required', 'boolean'],
                    'autoRemediation.downloadTrend' => ['required', 'boolean'],
                    'autoRemediation.ipCountChange' => ['required', 'boolean'],
                    'autoRemediation.failedSignIns' => ['required', 'boolean'],
                    'autoRemediation.suspiciousIp' => ['required', 'boolean'],
                ]),
            ),
            'device' => $request->validate([
                'defaultMode' => ['required', Rule::in(['standard', 'secure'])],
                'selfDestruct' => ['required', Rule::in(['Never', 'After 1 day offline', 'After 7 days offline', 'After 30 days offline'])],
            ]),
            'alerts' => $this->alertRules($request),
        };

        SecurityPolicies::put($section, $value, $request->user()->id);

        return response()->json(['status' => 'ok']);
    }

    /**
     * @return array<string, mixed>
     */
    private function signInRules(Request $request): array
    {
        $data = $request->validate([
            'minLength' => ['required', 'integer', 'between:8,64'],
            'numbersRequired' => ['required', 'integer', 'between:0,4'],
            'specialRequired' => ['required', 'integer', 'between:0,4'],
            'requireMfa' => ['required', 'boolean'],
            'requireMicrosoftConnect' => ['required', 'boolean'],
            'requireGoogleConnect' => ['required', 'boolean'],
            'requireAuthenticatorApp' => ['required', 'boolean'],
            'sessionDays' => ['required', 'integer', 'between:1,30'],
        ]);

        // One control on the screen, two stored flags so older rows and the
        // portal gate stay in agreement.
        $required = $request->boolean('requireAuthenticatorApp') || $request->boolean('requireMfa');
        $data['requireAuthenticatorApp'] = $required;
        $data['requireMfa'] = $required;

        return $data;
    }

    /**
     * The alert matrix, plus the alternate contacts.
     *
     * Contacts are validated one address at a time rather than as a blob, so a
     * typo names itself instead of being silently dropped later when
     * SecurityAlertPolicy filters the list.
     *
     * @return array<string, mixed>
     */
    private function alertRules(Request $request): array
    {
        $data = $request->validate([
            'newDevice.admins' => ['required', 'boolean'],
            'failedSignIns.admins' => ['required', 'boolean'],
            'impossibleTravel.admins' => ['sometimes', 'boolean'],
            'downloadTrend.admins' => ['sometimes', 'boolean'],
            'ipCountChange.admins' => ['sometimes', 'boolean'],
            'suspiciousIp.admins' => ['sometimes', 'boolean'],
            'malwareDetected.admins' => ['sometimes', 'boolean'],
            'failedSignInThreshold' => ['required', 'integer', 'between:3,20'],
            'alternateContacts' => ['present', 'string', 'max:2000'],
        ]);

        $contacts = array_values(array_filter(array_map('trim', explode(',', $data['alternateContacts']))));

        foreach ($contacts as $contact) {
            abort_unless(
                filter_var($contact, FILTER_VALIDATE_EMAIL),
                422,
                '“'.$contact.'” is not an email address.'
            );
        }

        return [
            'newDevice' => ['admins' => $request->boolean('newDevice.admins')],
            'failedSignIns' => ['admins' => $request->boolean('failedSignIns.admins')],
            'impossibleTravel' => ['admins' => $request->boolean('impossibleTravel.admins', true)],
            'downloadTrend' => ['admins' => $request->boolean('downloadTrend.admins', true)],
            'ipCountChange' => ['admins' => $request->boolean('ipCountChange.admins', false)],
            'suspiciousIp' => ['admins' => $request->boolean('suspiciousIp.admins', true)],
            'malwareDetected' => ['admins' => $request->boolean('malwareDetected.admins', true)],
            'failedSignInThreshold' => (int) $data['failedSignInThreshold'],
            'alternateContacts' => implode(', ', $contacts),
        ];
    }

    private function isAdmin(User $user): bool
    {
        return Role::can($user, 'settings.security');
    }
}
