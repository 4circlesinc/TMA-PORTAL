<?php

namespace App\Support\Onboarding;

use App\Models\OnboardingProgress;
use App\Models\User;

/**
 * The client onboarding flow: which steps exist, which ones apply, and what
 * each one accepts.
 *
 * Related questions share a screen so the person is not walked through a
 * dozen one-field pages. Older step URLs still resolve to the joined screen.
 */
final class ClientFlow
{
    /**
     * Step key => definition. Order here is the order of the wizard.
     *
     * `optional` marks a step the person may pass without answering; it still
     * counts as done once they have been through it.
     */
    private const STEPS = [
        'welcome' => ['title' => 'Welcome', 'optional' => true],
        'you' => ['title' => 'About you'],
        'contact' => ['title' => 'How we reach you'],
        'access' => ['title' => 'Your access', 'optional' => true],
        'terms' => ['title' => 'Terms and privacy'],
    ];

    /**
     * Old one-question URLs, mapped to the screen that now holds them.
     *
     * @var array<string, string>
     */
    public const LEGACY_STEPS = [
        'name' => 'you',
        'photo' => 'you',
        'email' => 'contact',
        'phone' => 'contact',
        'whatsapp' => 'contact',
        'contact-preference' => 'contact',
        'work' => 'access',
        'account-type' => 'access',
        'company' => 'access',
        'address' => 'access',
        'contacts' => 'access',
        'calendar' => 'access',
        'done' => 'terms',
    ];

    public const CONTACT_METHODS = ['Email', 'Phone', 'WhatsApp', 'Portal messages'];

    public const PHONE_RULE = ['nullable', 'string', 'max:32', 'regex:/^\+?[0-9 ()\-]{7,32}$/'];

    /** @return array<int, string> */
    public static function stepKeys(): array
    {
        return array_keys(self::STEPS);
    }

    public static function exists(string $step): bool
    {
        return array_key_exists($step, self::STEPS);
    }

    public static function resolve(string $step): ?string
    {
        if (self::exists($step)) {
            return $step;
        }

        return self::LEGACY_STEPS[$step] ?? null;
    }

    public static function title(string $step): string
    {
        return self::STEPS[$step]['title'] ?? ucfirst($step);
    }

    public static function isOptional(string $step): bool
    {
        return (bool) (self::STEPS[$step]['optional'] ?? false);
    }

    public static function applies(string $step, OnboardingProgress $progress): bool
    {
        return self::exists($step);
    }

    /** Only offer calendar connect where a provider is actually configured. */
    public static function calendarAvailable(): bool
    {
        return (bool) config('services.google.client_id')
            || (bool) config('services.microsoft.client_id');
    }

    /**
     * The steps that apply, in order.
     *
     * @return array<int, string>
     */
    public static function applicableSteps(OnboardingProgress $progress): array
    {
        return self::stepKeys();
    }

    /**
     * Whether this joined screen is already done, including people who
     * finished the old one-question steps that now live here.
     */
    public static function hasFinished(OnboardingProgress $progress, string $step): bool
    {
        if ($progress->hasDone($step)) {
            return true;
        }

        return match ($step) {
            'you' => $progress->hasDone('name'),
            'contact' => $progress->hasDone('email')
                && $progress->hasDone('phone')
                && $progress->hasDone('contact-preference'),
            'terms' => $progress->hasDone('done'),
            default => false,
        };
    }

    /** The first applicable step the person has not finished. */
    public static function nextUnfinished(OnboardingProgress $progress): string
    {
        foreach (self::applicableSteps($progress) as $step) {
            if (! self::hasFinished($progress, $step)) {
                return $step;
            }
        }

        return 'terms';
    }

    /** The step after this one. */
    public static function after(string $step, OnboardingProgress $progress): ?string
    {
        $steps = self::applicableSteps($progress);
        $at = array_search($step, $steps, true);

        if ($at === false) {
            return self::nextUnfinished($progress);
        }

        return $steps[$at + 1] ?? null;
    }

    /** The step before this one. */
    public static function before(string $step, OnboardingProgress $progress): ?string
    {
        $steps = self::applicableSteps($progress);
        $at = array_search($step, $steps, true);

        if ($at === false || $at === 0) {
            return null;
        }

        return $steps[$at - 1];
    }

    /** Position (1-based) and total, for the progress indicator. */
    public static function position(string $step, OnboardingProgress $progress): array
    {
        $steps = self::applicableSteps($progress);
        $at = array_search($step, $steps, true);

        return [
            'index' => $at === false ? 1 : $at + 1,
            'total' => count($steps),
            'done' => count(array_filter($steps, fn (string $key) => self::hasFinished($progress, $key))),
        ];
    }

    /**
     * Validation for one step. Keys match the form field names.
     *
     * @return array<string, mixed>
     */
    public static function rules(string $step): array
    {
        return match ($step) {
            'you' => [
                'first_name' => ['required', 'string', 'max:100'],
                'middle_name' => ['nullable', 'string', 'max:100'],
                'last_name' => ['required', 'string', 'max:100'],
                'photo' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            ],
            'contact' => [
                'email_confirmed' => ['accepted'],
                'phone' => array_merge(['required'], array_slice(self::PHONE_RULE, 1)),
                'uses_whatsapp' => ['nullable', 'boolean'],
                'whatsapp' => self::PHONE_RULE,
                'preferred_contact' => ['required', 'in:'.implode(',', self::CONTACT_METHODS)],
            ],
            'terms' => [
                'accept_terms' => ['accepted'],
            ],
            default => [],
        };
    }

    /** Messages that read like the screen rather than like a validator. */
    public static function messages(string $step): array
    {
        return match ($step) {
            'contact' => [
                'email_confirmed.accepted' => 'Please confirm this is the right email address.',
                'phone.regex' => 'Enter a phone number, like +1 555 123 4567.',
                'whatsapp.regex' => 'Enter a WhatsApp number, like +1 555 123 4567.',
                'preferred_contact.required' => 'Choose how you would like us to reach you.',
            ],
            'terms' => ['accept_terms.accepted' => 'Please accept the Terms and Privacy Policy to finish.'],
            default => [],
        };
    }

    /**
     * The values a step should start with, what they answered before, falling
     * back to what we already know about them.
     */
    public static function defaults(string $step, User $user, OnboardingProgress $progress): array
    {
        $saved = $progress->answers($step);

        if ($saved !== []) {
            return $saved;
        }

        $client = ClientProfile::for($user);
        $profile = $client?->data ?? [];

        return match ($step) {
            'you' => array_merge([
                'first_name' => $user->first_name ?: ($profile['firstName'] ?? ''),
                'middle_name' => $user->middle_name ?: ($profile['middleName'] ?? ''),
                'last_name' => $user->last_name ?: ($profile['lastName'] ?? ''),
            ], $progress->answers('name')),
            'contact' => array_merge(
                [
                    'phone' => $user->phone ?: ($client?->phone ?? ''),
                    'preferred_contact' => $profile['preferredContact'] ?? 'Email',
                ],
                $progress->answers('phone'),
                $progress->answers('whatsapp'),
                $progress->answers('email'),
                $progress->answers('contact-preference'),
            ),
            default => [],
        };
    }
}
