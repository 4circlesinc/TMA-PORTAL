<?php

namespace App\Actions\Fortify;

use App\Models\User;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use App\Support\Security\SecurityAlerts;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\UpdatesUserPasswords;

class UpdateUserPassword implements UpdatesUserPasswords
{
    use PasswordValidationRules;

    /**
     * Validate and update the user's password.
     *
     * @param  array<string, string>  $input
     *
     * @throws ValidationException
     */
    public function update(User $user, array $input): void
    {
        Validator::make($input, [
            'current_password' => ['required', 'string', 'current_password:web'],
            'password' => $this->passwordRules(),
        ], [
            'current_password.current_password' => __('The provided password does not match your current password.'),
        ])->validateWithBag('updatePassword');

        $user->forceFill([
            'password' => Hash::make($input['password']),
            'password_auto' => false,
        ])->save();

        // Confirm the change to the account owner, and put it in the bell.
        // Both honour the "Password changes" switch on Account settings →
        // Security; the reset-by-email path deliberately does not, because
        // there the person may not be the one who asked for the reset.
        if (SecurityAlerts::enabled($user, 'password_changed')) {
            Mail::to($user->email)->queue(Postcards::passwordChangedFor($user));

            Notifier::send([
                'user' => $user,
                'type' => 'security.password_changed',
                'title' => 'Your password was changed',
                'message' => 'If this was not you, secure your account immediately.',
                'action_url' => '/account-settings?settings-page=security',
                // The postcard above is the email for this; a second, generic
                // one would just say the same thing less well.
                'email' => false,
            ]);
        }
    }
}
