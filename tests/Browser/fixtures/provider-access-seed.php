<?php

/*
 * Two service providers for provider-access-card.mjs: Galaxy with nine
 * people on its Access card, enough to scroll, and Orbit with three.
 *
 * Some hold accounts and some are only invited, and one address is long
 * enough to wrap its row, which is what makes "six rows" a measurement.
 * Needs a migrated throwaway database; it makes its own administrator,
 * e2e@example.com. Safe to run twice. Prints the environment the check
 * wants as its last line.
 *
 *   php artisan tinker tests/Browser/fixtures/provider-access-seed.php < /dev/null
 */

use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyRoles;
use Illuminate\Support\Facades\Hash;

$account = function (string $name, string $email, string $type) {
    $u = User::where('email', $email)->first() ?? User::create([
        'name' => $name, 'email' => $email, 'password' => Hash::make('password12345'),
    ]);
    $u->forceFill([
        'email_verified_at' => now(), 'profile_completed_at' => now(),
        'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
    ])->save();

    return $u;
};

$admin = $account('E2E Admin', 'e2e@example.com', Role::ADMINISTRATOR);

$firm = function (string $uid, string $name, string $code, array $people) use ($admin, $account) {
    $company = Company::where('uid', $uid)->first()
        ?? Company::create(['uid' => $uid, 'name' => $name, 'created_by' => $admin->id, 'email' => 'office@'.$uid.'.example.com']);
    CipProvider::where('code', $code)->first()
        ?? CipProvider::create(['name' => $name, 'code' => $code, 'company_id' => $company->id]);

    foreach ($people as $i => [$person, $email, $hasAccount]) {
        if (CompanyMember::where('company_id', $company->id)->where('email', $email)->exists()) {
            continue;
        }
        $user = $hasAccount ? $account($person, $email, Role::SERVICE_PROVIDER_ADMIN) : null;
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $user?->id,
            'name' => $person,
            'email' => $email,
            'role' => 'member',
            'is_primary' => $i === 0,
            'status' => $user ? CompanyMember::STATUS_ACTIVE : CompanyMember::STATUS_INVITED,
            'added_by' => $admin->id,
            ...CompanyRoles::defaults('member'),
        ]);
    }

    return $company;
};

$galaxy = $firm('galaxy', 'Galaxy', 'GAL', [
    ['Ada Marsh', 'ada@galaxy.example.com', true],
    ['Ben Nolan', 'ben.nolan.long.address@galaxy-international-holdings.example.com', true],
    ['Cara Osei', 'cara@galaxy.example.com', true],
    ['Dan Price', 'dan@galaxy.example.com', false],
    ['Eve Quinn', 'eve@galaxy.example.com', true],
    ['Finn Reyes', 'finn@galaxy.example.com', false],
    ['Gia Stone', 'gia@galaxy.example.com', true],
    ['Hal Turner', 'hal@galaxy.example.com', true],
    ['Ivy Underwood', 'ivy@galaxy.example.com', false],
]);

$orbit = $firm('orbit', 'Orbit', 'ORB', [
    ['Jo Vance', 'jo@orbit.example.com', true],
    ['Kit Wells', 'kit@orbit.example.com', false],
    ['Lee Young', 'lee@orbit.example.com', true],
]);

echo 'TMA_COMPANY_MANY='.$galaxy->uid.' TMA_COMPANY_FEW='.$orbit->uid.PHP_EOL;
