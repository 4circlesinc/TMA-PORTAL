<?php

namespace App\Support\Onboarding;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\SecurityPolicies;

/**
 * Steps every account walks through after "Set up your account"
 * (getting-started for staff, client wizard for clients).
 */
final class AccountSetupFlow
{
    public const FLOW = 'account-setup';

    /** Virtual first screen for staff — the getting-started connect checklist. */
    public const ACCOUNTS = 'accounts';

    /** @var array<string, array{title: string, optional?: bool}> */
    private const STEPS = [
        'preferences' => ['title' => 'Your preferences'],
        'two-factor' => ['title' => 'Two-factor authentication', 'optional' => true],
        'notifications' => ['title' => 'Notifications'],
        'email' => ['title' => 'Email'],
    ];

    /** Groups shown on the simplified notifications onboarding screen. */
    public const NOTIFICATION_GROUPS = [
        'messages' => 'Messages',
        'email' => 'Email',
        'calendar' => 'Calendar',
        'files' => 'Files',
        'approvals' => 'Approvals',
    ];

    /** @return array<int, string> */
    public static function stepKeys(): array
    {
        return array_keys(self::STEPS);
    }

    public static function exists(string $step): bool
    {
        return array_key_exists($step, self::STEPS);
    }

    public static function title(string $step): string
    {
        return self::STEPS[$step]['title'] ?? ucfirst($step);
    }

    public static function isOptional(string $step): bool
    {
        if ($step === 'two-factor') {
            $policy = SecurityPolicies::get('sign-in');
            $required = (bool) ($policy['requireAuthenticatorApp'] ?? false)
                || (bool) ($policy['requireMfa'] ?? false);

            return ! $required;
        }

        return (bool) (self::STEPS[$step]['optional'] ?? false);
    }

    public static function applies(string $step, User $user): bool
    {
        if ($step === 'email') {
            return Role::can($user, 'mail.use');
        }

        return true;
    }

    /** @return array<int, string> */
    public static function applicableSteps(User $user): array
    {
        return array_values(array_filter(
            self::stepKeys(),
            fn (string $step) => self::applies($step, $user),
        ));
    }

    public static function nextAfter(string $step, User $user): ?string
    {
        $steps = self::applicableSteps($user);
        $index = array_search($step, $steps, true);

        if ($index === false) {
            return $steps[0] ?? null;
        }

        return $steps[$index + 1] ?? null;
    }

    public static function firstStep(User $user): string
    {
        return self::applicableSteps($user)[0] ?? 'preferences';
    }

    /**
     * Every screen in the post-approval walkthrough, including getting-started
     * for staff so "1 of N complete" is the same counter on every page.
     *
     * @return array<int, string>
     */
    public static function screens(User $user): array
    {
        $steps = self::applicableSteps($user);

        if (! Role::isClient($user)) {
            array_unshift($steps, self::ACCOUNTS);
        }

        return $steps;
    }

    /** @return array{index: int, total: int} */
    public static function position(string $step, User $user): array
    {
        $screens = self::screens($user);
        $index = array_search($step, $screens, true);

        return [
            'index' => $index === false ? 1 : $index + 1,
            'total' => max(count($screens), 1),
        ];
    }

    public static function previousStep(string $step, User $user): ?string
    {
        $screens = self::screens($user);
        $index = array_search($step, $screens, true);

        if ($index === false || $index < 1) {
            return null;
        }

        return $screens[$index - 1];
    }

    public static function routeFor(string $step): string
    {
        if ($step === self::ACCOUNTS) {
            return route('getting-started');
        }

        return route('account-setup.show', ['step' => $step]);
    }

    public static function routeForStep(string $step): string
    {
        return route('account-setup.show', ['step' => $step]);
    }

    public static function redirectFor(User $user): ?string
    {
        $step = $user->preferences['accountSetupStep'] ?? null;

        if ($step === null || $step === 'done') {
            return null;
        }

        if (! self::exists($step) || ! self::applies($step, $user)) {
            return self::routeForStep(self::firstStep($user));
        }

        return self::routeForStep($step);
    }

    public static function begin(User $user): void
    {
        $prefs = $user->preferences ?? [];
        $step = $prefs['accountSetupStep'] ?? null;

        if ($step !== null && $step !== 'done') {
            return;
        }

        $prefs['accountSetupStep'] = self::firstStep($user);
        $user->forceFill(['preferences' => $prefs])->save();
    }

    public static function advance(User $user, string $completedStep): void
    {
        $next = self::nextAfter($completedStep, $user);
        $prefs = $user->preferences ?? [];

        if ($next === null) {
            unset($prefs['accountSetupStep']);
            $user->forceFill([
                'preferences' => $prefs,
                'onboarding_completed_at' => $user->onboarding_completed_at ?? now(),
            ])->save();

            return;
        }

        $prefs['accountSetupStep'] = $next;
        $user->forceFill(['preferences' => $prefs])->save();
    }

    public static function skip(User $user, string $step): void
    {
        if (! self::isOptional($step)) {
            return;
        }

        self::advance($user, $step);
    }

    public static function isComplete(User $user): bool
    {
        $step = $user->preferences['accountSetupStep'] ?? null;

        // A stamped completion date must not skip the rest of the walkthrough.
        // Existing accounts were backfilled with onboarding_completed_at, and
        // Continue then jumped straight to the portal.
        if (is_string($step) && $step !== 'done' && self::exists($step)) {
            return false;
        }

        if ($user->onboarding_completed_at !== null) {
            return true;
        }

        if (! self::accountsPhaseComplete($user)) {
            return false;
        }

        return $step === null || $step === 'done';
    }

    public static function accountsPhaseComplete(User $user): bool
    {
        return (bool) ($user->preferences['accountsSetupComplete'] ?? false);
    }

    public static function markAccountsPhaseComplete(User $user): void
    {
        $prefs = $user->preferences ?? [];
        $prefs['accountsSetupComplete'] = true;
        $user->forceFill(['preferences' => $prefs])->save();
    }
}
