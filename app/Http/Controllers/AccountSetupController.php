<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\AuthenticatorApp;
use App\Support\Notifications\NotificationPreferences;
use App\Support\Notifications\NotificationType;
use App\Support\Onboarding\AccountSetupFlow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Actions\GenerateNewRecoveryCodes;

class AccountSetupController extends Controller
{
    public function show(Request $request, string $step): View|RedirectResponse
    {
        $user = $request->user();

        if ($this->mustFinishAccountsPhase($user)) {
            return $this->accountsRedirect($user);
        }

        if (! AccountSetupFlow::exists($step) || ! AccountSetupFlow::applies($step, $user)) {
            return redirect()->route('account-setup.show', ['step' => AccountSetupFlow::firstStep($user)]);
        }

        AccountSetupFlow::begin($user);
        $user->refresh();

        $steps = AccountSetupFlow::applicableSteps($user);
        $current = $user->preferences['accountSetupStep'] ?? AccountSetupFlow::firstStep($user);
        $currentIndex = array_search($current, $steps, true);
        $requestedIndex = array_search($step, $steps, true);

        if ($requestedIndex === false) {
            return redirect()->route('account-setup.show', ['step' => AccountSetupFlow::firstStep($user)]);
        }

        // Don't skip ahead. Going back is allowed, and becomes the resume point.
        if ($currentIndex !== false && $requestedIndex > $currentIndex) {
            return redirect()->route('account-setup.show', ['step' => $current]);
        }

        if ($requestedIndex < $currentIndex) {
            $prefs = $user->preferences ?? [];
            $prefs['accountSetupStep'] = $step;
            $user->forceFill(['preferences' => $prefs])->save();
        }

        if ($step === 'two-factor') {
            // Fortify's 2FA routes require a recent password confirmation, skip
            // that during onboarding by marking the session confirmed here.
            $request->session()->put('auth.password_confirmed_at', time());
        }

        $position = AccountSetupFlow::position($step, $user);
        $previous = AccountSetupFlow::previousStep($step, $user);

        return view('auth.setup.'.$step, array_merge([
            'user' => $user,
            'step' => $step,
            'title' => AccountSetupFlow::title($step),
            'index' => $position['index'],
            'total' => $position['total'],
            'optional' => AccountSetupFlow::isOptional($step),
            'steps' => $steps,
            'previousUrl' => $previous ? AccountSetupFlow::routeFor($previous) : null,
        ], $this->stepData($user, $step), $step === 'two-factor'
            ? $this->twoFactorPanelData($request, $user)
            : []));
    }

    public function store(Request $request, string $step): RedirectResponse
    {
        $user = $request->user();

        if (! AccountSetupFlow::exists($step) || ! AccountSetupFlow::applies($step, $user)) {
            return redirect()->route('account-setup.show', ['step' => AccountSetupFlow::firstStep($user)]);
        }

        match ($step) {
            'preferences' => $this->storePreferences($request, $user),
            'two-factor' => $this->storeTwoFactor($request, $user),
            'notifications' => $this->storeNotifications($request, $user),
            'email' => $this->storeEmail($request, $user),
            default => null,
        };

        AccountSetupFlow::advance($user, $step);

        return $this->redirectAfterStep($user, $step);
    }

    public function skip(Request $request, string $step): RedirectResponse
    {
        $user = $request->user();

        if (! AccountSetupFlow::isOptional($step)) {
            return redirect()->route('account-setup.show', ['step' => $step]);
        }

        AccountSetupFlow::skip($user, $step);

        return $this->redirectAfterStep($user, $step);
    }

    private function redirectAfterStep(User $user, string $step): RedirectResponse
    {
        $user->refresh();
        $next = AccountSetupFlow::nextAfter($step, $user);

        if ($next === null) {
            return redirect('/');
        }

        return redirect()->route('account-setup.show', ['step' => $next]);
    }

    /** @return array<string, mixed> */
    private function stepData(User $user, string $step): array
    {
        return match ($step) {
            'preferences' => [
                'prefs' => array_merge([
                    'themeMode' => 'light',
                    'fontScale' => 3,
                    'sidebarStyle' => 'hover',
                ], array_intersect_key($user->preferences ?? [], array_flip(['themeMode', 'fontScale', 'sidebarStyle']))),
            ],
            'two-factor' => [
                'twoFactorOn' => $user->hasTwoFactorEnabled(),
                'authApps' => [
                    AuthenticatorApp::meta('microsoft'),
                    AuthenticatorApp::meta('google'),
                ],
            ],
            'notifications' => [
                'groups' => AccountSetupFlow::NOTIFICATION_GROUPS,
                'prefs' => NotificationPreferences::forUser($user),
                'nonSilenceable' => NotificationType::NON_SILENCEABLE,
            ],
            'email' => [
                'microsoft' => $user->connectedAccount('microsoft'),
                'mail' => $this->mailPrefs($user),
            ],
            default => [],
        };
    }

    private function storePreferences(Request $request, User $user): void
    {
        $data = $request->validate([
            'themeMode' => ['required', Rule::in(['light', 'dark', 'system'])],
            'fontScale' => ['required', 'integer', 'between:1,5'],
            'sidebarStyle' => ['required', Rule::in(['standard', 'hover'])],
        ]);

        $prefs = $user->preferences ?? [];
        foreach ($data as $key => $value) {
            $prefs[$key] = $key === 'fontScale' ? (int) $value : $value;
        }
        $user->forceFill(['preferences' => $prefs])->save();
    }

    private function storeTwoFactor(Request $request, User $user): void
    {
        if ($user->hasTwoFactorEnabled()) {
            return;
        }

        // Optional 2FA: Continue posts here with no code and must still
        // advance. Requiring a code trapped people on this screen.
        if (! $request->filled('code') && AccountSetupFlow::isOptional('two-factor')) {
            return;
        }

        $data = $request->validate([
            'app' => ['required', Rule::in(AuthenticatorApp::KEYS)],
            'code' => ['required', 'string', 'size:6'],
        ]);

        $user->forceFill(['two_factor_app' => $data['app']])->save();

        if (! $user->two_factor_secret) {
            app(EnableTwoFactorAuthentication::class)($user);
            $user->refresh();
        }

        app(ConfirmTwoFactorAuthentication::class)($user, $data['code']);

        if ($user->two_factor_recovery_codes === null) {
            app(GenerateNewRecoveryCodes::class)($user);
        }
    }

    private function storeNotifications(Request $request, User $user): void
    {
        $rules = [];
        foreach (array_keys(AccountSetupFlow::NOTIFICATION_GROUPS) as $group) {
            $rules["{$group}.portal"] = ['boolean'];
            $rules["{$group}.desktop"] = ['boolean'];
        }

        $data = $request->validate($rules);

        $stored = $user->preferences['notifications'] ?? [];
        foreach ($data as $group => $channels) {
            $stored[$group] = array_merge($stored[$group] ?? [], $channels);
            if (in_array($group, NotificationType::NON_SILENCEABLE, true)) {
                $stored[$group]['portal'] = true;
            }
        }

        $prefs = $user->preferences ?? [];
        $prefs['notifications'] = $stored;
        $user->forceFill(['preferences' => $prefs])->save();
    }

    private function storeEmail(Request $request, User $user): void
    {
        $data = $request->validate([
            'layout' => ['required', Rule::in(['split', 'single'])],
            'sidebarMode' => ['required', Rule::in(['full', 'icons', 'hidden'])],
        ]);

        $prefs = $user->preferences ?? [];
        $mail = $prefs['mail'] ?? [];
        $mail['layout'] = $data['layout'];
        $mail['sidebarMode'] = $data['sidebarMode'];
        $prefs['mail'] = $mail;
        $user->forceFill(['preferences' => $prefs])->save();
    }

    public function twoFactorQr(Request $request): JsonResponse
    {
        $this->ensureTwoFactorStep($request);

        $user = $request->user();
        if (! $user->two_factor_secret) {
            app(EnableTwoFactorAuthentication::class)($user);
            $user->refresh();
        }

        return response()->json([
            'svg' => $user->twoFactorQrCodeSvg(),
            'secretKey' => decrypt($user->two_factor_secret),
        ]);
    }

    public function twoFactorRecoveryCodes(Request $request): JsonResponse
    {
        $this->ensureTwoFactorStep($request);

        return response()->json($request->user()->recoveryCodes());
    }

    /** @return array<string, mixed> */
    private function twoFactorPanelData(Request $request, User $user): array
    {
        if ($user->hasTwoFactorEnabled()) {
            return [
                'panel' => 'done',
                'chosenApp' => 'microsoft',
                'qrSvg' => null,
                'secretKey' => null,
            ];
        }

        $panel = $request->query('panel', 'app');
        if (! in_array($panel, ['app', 'scan', 'confirm'], true)) {
            $panel = 'app';
        }

        $chosenApp = $request->query('app', 'microsoft');
        if (! in_array($chosenApp, AuthenticatorApp::KEYS, true)) {
            $chosenApp = 'microsoft';
        }

        $qrSvg = null;
        $secretKey = null;

        if (in_array($panel, ['scan', 'confirm'], true)) {
            if (! $user->two_factor_secret) {
                app(EnableTwoFactorAuthentication::class)($user);
                $user->refresh();
            }
            $qrSvg = $user->twoFactorQrCodeSvg();
            $secretKey = decrypt($user->two_factor_secret);
        }

        return [
            'panel' => $panel,
            'chosenApp' => $chosenApp,
            'qrSvg' => $qrSvg,
            'secretKey' => $secretKey,
        ];
    }

    private function ensureTwoFactorStep(Request $request): void
    {
        abort_unless(
            ($request->user()->preferences['accountSetupStep'] ?? null) === 'two-factor',
            403,
        );
        $request->session()->put('auth.password_confirmed_at', time());
    }

    /** @return array<string, mixed> */
    private function mailPrefs(User $user): array
    {
        $mail = $user->preferences['mail'] ?? [];

        return [
            'layout' => in_array($mail['layout'] ?? '', ['split', 'single'], true) ? $mail['layout'] : 'split',
            // Full was the previous implicit default. Treat it as unset so the
            // setup screen lands on Icons only unless they picked Hidden.
            'sidebarMode' => in_array($mail['sidebarMode'] ?? '', ['icons', 'hidden'], true)
                ? $mail['sidebarMode'] : 'icons',
            'signature' => (string) ($mail['signature'] ?? ''),
        ];
    }

    private function mustFinishAccountsPhase(User $user): bool
    {
        if (AccountSetupFlow::accountsPhaseComplete($user)) {
            return false;
        }

        if (Role::isClient($user)) {
            $progress = $user->onboardingProgress;

            return ! $progress || $progress->completed_at === null;
        }

        return true;
    }

    private function accountsRedirect(User $user): RedirectResponse
    {
        if (Role::isClient($user)) {
            return redirect()->route('onboarding.index');
        }

        return redirect()->route('getting-started');
    }
}
