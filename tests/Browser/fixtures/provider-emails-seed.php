<?php

/*
 * Three accounts for provider-emails-page.mjs: an administrator, an officer
 * and a client, every one with no preferences stored, so each run sees what
 * an untouched Service Provider Emails page answers for its role (on for the
 * officer, off for the administrator, absent for the client).
 *
 * Needs a migrated throwaway database with FEATURE_CIP on. Safe to run twice.
 *
 *   php artisan tinker tests/Browser/fixtures/provider-emails-seed.php < /dev/null
 */

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Support\Facades\Hash;

$account = function (string $name, string $email, string $type) {
    $u = User::where('email', $email)->first() ?? User::create([
        'name' => $name, 'email' => $email, 'password' => Hash::make('password12345'),
    ]);
    $u->forceFill([
        'email_verified_at' => now(), 'profile_completed_at' => now(),
        'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        'preferences' => null,
    ])->save();

    return $u;
};

$account('E2E Admin', 'e2e@example.com', Role::ADMINISTRATOR);
$account('Rita Officer', 'rita@example.com', Role::REVIEWING_OFFICER);
$account('Gil Client', 'gil@example.com', Role::CLIENT);

echo 'seeded: e2e@example.com (admin), rita@example.com (officer), gil@example.com (client)'.PHP_EOL;
