<?php

namespace App\Support\Onboarding;

use App\Models\OnboardingProgress;
use App\Models\User;

/**
 * The client onboarding flow: which steps exist, which ones apply to a given
 * person, and what each one accepts.
 *
 * One definition drives everything, the step order, the progress dots, the
 * validation, the review screen and the "what's left" calculation, so a step
 * cannot appear in the wizard but be missing from the count, or be validated
 * differently from the way it is rendered.
 *
 * Three steps are conditional, per the spec's "where applicable":
 *   - company   only when the person said they are a company
 *   - whatsapp  only when they said they use WhatsApp
 *   - calendar  only when a provider is actually configured in this environment
 * A step that stops applying keeps its stored answer (so switching back does
 * not lose it) but drops out of the count and is skipped when navigating.
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
        'name' => ['title' => 'Your name'],
        'photo' => ['title' => 'Photo or logo', 'optional' => true],
        'email' => ['title' => 'Confirm email'],
        'phone' => ['title' => 'Phone number'],
        'whatsapp' => ['title' => 'WhatsApp', 'optional' => true],
        'account-type' => ['title' => 'Individual or company'],
        'company' => ['title' => 'Company details'],
        'address' => ['title' => 'Address', 'optional' => true],
        'contact-preference' => ['title' => 'Preferred contact'],
        'contacts' => ['title' => 'Additional contacts', 'optional' => true],
        'calendar' => ['title' => 'Calendar', 'optional' => true],
        'access' => ['title' => 'Your access', 'optional' => true],
        'terms' => ['title' => 'Terms and privacy'],
        'done' => ['title' => 'All set', 'optional' => true],
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

    public static function title(string $step): string
    {
        return self::STEPS[$step]['title'] ?? ucfirst($step);
    }

    public static function isOptional(string $step): bool
    {
        return (bool) (self::STEPS[$step]['optional'] ?? false);
    }

    /**
     * Does this step apply to this person, given what they have answered?
     */
    public static function applies(string $step, OnboardingProgress $progress): bool
    {
        return match ($step) {
            'company' => (($progress->answers('account-type')['account_type'] ?? null) === 'company'),
            'whatsapp' => (bool) ($progress->answers('phone')['uses_whatsapp'] ?? false),
            'calendar' => self::calendarAvailable(),
            default => true,
        };
    }

    /** Only offer the calendar step where a provider is actually configured. */
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
        return array_values(array_filter(
            self::stepKeys(),
            fn (string $step) => self::applies($step, $progress),
        ));
    }

    /** The first applicable step the person has not finished. */
    public static function nextUnfinished(OnboardingProgress $progress): string
    {
        foreach (self::applicableSteps($progress) as $step) {
            if (! $progress->hasDone($step)) {
                return $step;
            }
        }

        return 'done';
    }

    /** The step after this one, skipping any that no longer apply. */
    public static function after(string $step, OnboardingProgress $progress): ?string
    {
        $steps = self::applicableSteps($progress);
        $at = array_search($step, $steps, true);

        if ($at === false) {
            return self::nextUnfinished($progress);
        }

        return $steps[$at + 1] ?? null;
    }

    /** The step before this one, skipping any that no longer apply. */
    public static function before(string $step, OnboardingProgress $progress): ?string
    {
        $steps = self::applicableSteps($progress);
        $at = array_search($step, $steps, true);

        if ($at === false || $at === 0) {
            return null;
        }

        return $steps[$at - 1] ?? null;
    }

    /** Position (1-based) and total, for the progress indicator. */
    public static function position(string $step, OnboardingProgress $progress): array
    {
        $steps = self::applicableSteps($progress);
        $at = array_search($step, $steps, true);

        return [
            'index' => $at === false ? 1 : $at + 1,
            'total' => count($steps),
            'done' => count(array_intersect($progress->done(), $steps)),
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
            'name' => [
                'first_name' => ['required', 'string', 'max:100'],
                'middle_name' => ['nullable', 'string', 'max:100'],
                'last_name' => ['required', 'string', 'max:100'],
            ],
            'photo' => [
                'photo' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            ],
            'email' => [
                'email_confirmed' => ['accepted'],
            ],
            'phone' => [
                'phone' => array_merge(['required'], array_slice(self::PHONE_RULE, 1)),
                'uses_whatsapp' => ['nullable', 'boolean'],
            ],
            'whatsapp' => [
                'whatsapp' => self::PHONE_RULE,
            ],
            'account-type' => [
                'account_type' => ['required', 'in:individual,company'],
            ],
            'company' => [
                'company_name' => ['required', 'string', 'max:255'],
                'company_role' => ['nullable', 'string', 'max:120'],
                'company_website' => ['nullable', 'string', 'max:255'],
            ],
            'address' => [
                'street' => ['nullable', 'string', 'max:255'],
                'city' => ['nullable', 'string', 'max:120'],
                'region' => ['nullable', 'string', 'max:120'],
                'postcode' => ['nullable', 'string', 'max:32'],
                'country' => ['nullable', 'string', 'max:120'],
            ],
            'contact-preference' => [
                'preferred_contact' => ['required', 'in:'.implode(',', self::CONTACT_METHODS)],
            ],
            'contacts' => [
                'contacts' => ['nullable', 'array', 'max:10'],
                'contacts.*.name' => ['nullable', 'string', 'max:120'],
                'contacts.*.email' => ['nullable', 'email', 'max:255'],
                'contacts.*.role' => ['nullable', 'string', 'max:120'],
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
            'email' => ['email_confirmed.accepted' => 'Please confirm this is the right email address.'],
            'terms' => ['accept_terms.accepted' => 'Please accept the Terms and Privacy Policy to finish.'],
            'phone' => ['phone.regex' => 'Enter a phone number, like +1 555 123 4567.'],
            'whatsapp' => ['whatsapp.regex' => 'Enter a WhatsApp number, like +1 555 123 4567.'],
            'account-type' => ['account_type.required' => 'Choose whether this account is for you or a company.'],
            'contact-preference' => ['preferred_contact.required' => 'Choose how you would like us to reach you.'],
            default => [],
        };
    }

    /**
     * The values a step should start with, what they answered before, falling
     * back to what we already know about them. This is what makes the flow
     * feel like it remembers, and it is why the invited client is not asked to
     * retype the name and email the staff member already entered.
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
            'name' => [
                'first_name' => $user->first_name ?: ($profile['firstName'] ?? ''),
                'middle_name' => $user->middle_name ?: ($profile['middleName'] ?? ''),
                'last_name' => $user->last_name ?: ($profile['lastName'] ?? ''),
            ],
            'phone' => ['phone' => $user->phone ?: ($client?->phone ?? '')],
            'account-type' => [
                'account_type' => ($client?->company_id || ! empty($profile['work']['company']))
                    ? 'company'
                    : 'individual',
            ],
            'company' => [
                'company_name' => $client?->companyRecord?->name
                    ?: ($profile['work']['company'] ?? ''),
                'company_role' => $profile['work']['jobTitle'] ?? '',
                'company_website' => $client?->companyRecord?->website ?? '',
            ],
            'address' => self::firstAddress($profile),
            default => [],
        };
    }

    /** @return array<string, string> */
    private static function firstAddress(array $profile): array
    {
        $first = ($profile['addresses'] ?? [])[0] ?? [];

        return [
            'street' => $first['street'] ?? ($first['value'] ?? ''),
            'city' => $first['city'] ?? '',
            'region' => $first['region'] ?? '',
            'postcode' => $first['postcode'] ?? '',
            'country' => $first['country'] ?? '',
        ];
    }
}
