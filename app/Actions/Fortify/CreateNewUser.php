<?php

namespace App\Actions\Fortify;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\CreatesNewUsers;

class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules;

    /**
     * Validate and create a newly registered user.
     *
     * @param  array<string, string>  $input
     *
     * @throws ValidationException
     */
    public function create(array $input): User
    {
        Validator::make($input, [
            'first_name' => ['required', 'string', 'max:100'],
            'middle_name' => ['nullable', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'gender' => ['required', Rule::in(['Female', 'Male', 'Non-binary', 'Prefer not to say'])],
            'email' => [
                'required',
                'string',
                'email',
                'max:255',
                Rule::unique(User::class),
            ],
            'password' => $this->passwordRules(),
            'terms' => ['accepted'],
        ], [
            'terms.accepted' => 'Please accept the Terms of Service and Privacy Policy to continue.',
        ])->validate();

        $user = User::create([
            'first_name' => trim($input['first_name']),
            'middle_name' => filled($input['middle_name'] ?? null) ? trim($input['middle_name']) : null,
            'last_name' => trim($input['last_name']),
            'gender' => $input['gender'],
            'email' => $input['email'],
            'password' => Hash::make($input['password']),
            // Placeholder until syncDisplayName() runs — the column is NOT NULL.
            'name' => trim($input['first_name'].' '.$input['last_name']),
        ]);

        $user->syncDisplayName();
        $user->save();

        return $user;
    }
}
