<?php

namespace App\Actions\Fortify;

use App\Support\SecurityPolicies;
use Closure;
use Illuminate\Contracts\Validation\Rule;
use Illuminate\Validation\Rules\Password;

trait PasswordValidationRules
{
    /**
     * NIST-style baseline (length + HIBP breached-password check) plus the
     * administrator-configured sign-in policy from Account settings.
     *
     * @return array<int, Rule|array<mixed>|string|Closure>
     */
    protected function passwordRules(): array
    {
        $policy = SecurityPolicies::get('sign-in');

        $rules = [
            'required',
            'string',
            Password::min(max(8, (int) $policy['minLength']))->max(255)->uncompromised(),
            'confirmed',
        ];

        if (($need = (int) $policy['numbersRequired']) > 0) {
            $rules[] = function (string $attribute, mixed $value, Closure $fail) use ($need) {
                if (preg_match_all('/[0-9]/', (string) $value) < $need) {
                    $fail("The password must contain at least {$need} number".($need === 1 ? '' : 's').'.');
                }
            };
        }

        if (($need = (int) $policy['specialRequired']) > 0) {
            $rules[] = function (string $attribute, mixed $value, Closure $fail) use ($need) {
                if (preg_match_all('/[^A-Za-z0-9]/', (string) $value) < $need) {
                    $fail("The password must contain at least {$need} special character".($need === 1 ? '' : 's').'.');
                }
            };
        }

        return $rules;
    }
}
