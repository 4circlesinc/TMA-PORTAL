<?php

namespace App\Console\Commands;

use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Files\FolderProvisioner;
use App\Support\LoginChallenge;
use App\Support\Messaging\ClientConversations;
use App\Support\Privacy\PrivacyPolicy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The demo account App Review signs in with (docs/app-store.md).
 *
 *   php artisan app-review:account appreview@tmantoinelaw.com
 *   php artisan app-review:account appreview@tmantoinelaw.com --reset-password
 *
 * It makes what accepting a client invitation makes, an approved client
 * account on its own client record with the record's main folder, without the
 * invitation email, and with the profile and onboarding screens marked done so
 * the reviewer lands on the dashboard. A client record already carrying the
 * address and no account is used rather than duplicated. The password is
 * printed once.
 *
 * It only ever touches a client account. A staff or administrator account
 * under the address is refused, never converted.
 */
class AppReviewAccount extends Command
{
    protected $signature = 'app-review:account
                            {email : The demo account\'s email address}
                            {--name=Demo Client : The name on the account and its client record}
                            {--reset-password : Give the existing demo account a new password}';

    protected $description = 'Create the App Review demo account, or give it a new password';

    public function handle(): int
    {
        $email = Str::lower(trim((string) $this->argument('email')));

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error("{$email} is not an email address.");

            return self::FAILURE;
        }

        $user = User::where('email', $email)->first();

        if ($user !== null) {
            if (! Role::isClient($user)) {
                $this->error("{$email} belongs to a {$user->account_type} account. Only a client account can be the demo account.");

                return self::FAILURE;
            }

            if (! $this->option('reset-password')) {
                $this->info("{$email} already has an account. Pass --reset-password to give it a new password.");
                $this->warnings($user);

                return self::SUCCESS;
            }

            $password = $this->newPassword();
            $user->forceFill(['password' => $password])->save();

            $this->info("New password for {$email}:");
            $this->line($password);
            $this->warnings($user);

            return self::SUCCESS;
        }

        $name = trim((string) $this->option('name')) ?: 'Demo Client';
        $password = $this->newPassword();

        $user = DB::transaction(function () use ($email, $name, $password) {
            $first = Str::before($name, ' ');
            $last = str_contains($name, ' ') ? trim(Str::after($name, ' ')) : '';

            $user = new User([
                'first_name' => $first,
                'last_name' => $last !== '' ? $last : null,
                'email' => $email,
                'password' => $password,
            ]);
            $user->syncDisplayName();
            $user->forceFill([
                'email_verified_at' => now(),
                'status' => User::STATUS_APPROVED,
                'account_type' => Role::CLIENT,
                'approved_at' => now(),
                'profile_completed_at' => now(),
                'onboarding_completed_at' => now(),
            ])->save();

            PrivacyPolicy::recordAcceptance($user);

            $client = Client::query()
                ->whereNull('user_id')
                ->whereRaw('lower(email) = ?', [$email])
                ->first();

            if ($client !== null) {
                $client->forceFill(['user_id' => $user->id])->save();
            } else {
                $client = Client::create([
                    'uid' => $this->uniqueClientUid(Str::slug($name) ?: 'demo-client'),
                    'name' => $name,
                    'client_type' => 'private',
                    'referral_type' => Client::REFERRAL_NONE,
                    'email' => $email,
                    'user_id' => $user->id,
                    'initial' => mb_strtoupper(mb_substr($name, 0, 1)),
                    'initial_color' => 'blue',
                    'data' => [
                        'firstName' => $first,
                        'lastName' => $last,
                        'emails' => [['type' => 'work', 'value' => $email]],
                        'phones' => [],
                        'addresses' => [],
                        'importantDates' => [],
                        'work' => [],
                    ],
                ]);
            }

            FolderProvisioner::provisionClientFolder($client);
            ClientConversations::attachLogin($user);

            return $user;
        });

        $this->info("Created the demo account {$email} on the client record \"{$user->clientRecord?->name}\".");
        $this->info('Password (shown once):');
        $this->line($password);
        $this->warnings($user);

        return self::SUCCESS;
    }

    /** What would still stop a reviewer, said after every run. */
    private function warnings(User $user): void
    {
        if (! LoginChallenge::isReviewAccount($user)) {
            $this->warn("Add {$user->email} to APP_REVIEW_EMAILS and redeploy, or a sign-in from a new device asks for an emailed code.");
        }

        if ($user->hasTwoFactorEnabled()) {
            $this->warn('This account has an authenticator. Turn it off, because the reviewer cannot read its codes.');
        }
    }

    /** Easy to type on a phone: letters and digits only. */
    private function newPassword(): string
    {
        return Str::password(20, symbols: false);
    }

    private function uniqueClientUid(string $base): string
    {
        $uid = $base;
        $n = 2;

        while (Client::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$n++;
        }

        return $uid;
    }
}
