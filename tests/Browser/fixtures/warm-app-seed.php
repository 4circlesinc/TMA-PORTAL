<?php

/*
 * Everything warm-app.mjs walks through, on a fresh throwaway database: an
 * administrator e2e@example.com, two colleagues to message (Rita Officer, and
 * Sam Clerk, whose conversation is never opened while connected), and
 * one CIP application for the client Chen Wei.
 *
 *   php artisan tinker tests/Browser/fixtures/warm-app-seed.php < /dev/null
 */

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Cip\Applications;

$person = function (string $email, string $name) {
    $user = User::firstOrCreate(['email' => $email], ['name' => $name, 'password' => bcrypt('password12345')]);
    $user->forceFill([
        'email_verified_at' => now(), 'profile_completed_at' => now(),
        'onboarding_completed_at' => now(), 'status' => 'approved',
        'account_type' => 'Administrator',
    ])->save();

    return $user;
};

$admin = $person('e2e@example.com', 'E2E Admin');
$person('rita@example.com', 'Rita Officer');
$person('sam@example.com', 'Sam Clerk');

$company = Company::firstOrCreate(['uid' => 'galaxy'], ['name' => 'Galaxy', 'created_by' => $admin->id]);
$provider = CipProvider::firstOrCreate(['code' => 'GAL'], ['name' => 'Galaxy', 'company_id' => $company->id]);
$client = Client::firstOrCreate(['uid' => 'chen-wei'], [
    'name' => 'Chen Wei', 'email' => 'chen@example.com', 'created_by' => $admin->id, 'data' => [],
]);
if (! $client->wasRecentlyCreated) {
    echo "already seeded\n";

    return;
}
Applications::create($provider, $admin, ['client_id' => $client->id]);
echo "TMA_CLIENT={$client->uid}\n";
