<?php

namespace App\Console\Commands;

use App\Models\CipApplication;
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
 *   php artisan app-review:account appreview@tmantoinelaw.com --client="Jane Sample"
 *
 * It makes what accepting a client invitation makes, an approved client
 * account on its own client record with the record's main folder, without the
 * invitation email, and with the profile and onboarding screens marked done so
 * the reviewer lands on the dashboard. A client record already carrying the
 * address and no account is used rather than duplicated. The password is
 * printed once.
 *
 * --client puts the account on another client record, by uid or exact name.
 * An application always makes a client record of its own for the main
 * applicant, so this is how the demo account reaches a sample application.
 * The record must not have a login of its own, the rule invitations keep; any
 * other record the demo account sat on is let go, and keeps its data.
 *
 * It only ever touches a client account. A staff or administrator account
 * under the address is refused, never converted.
 */
class AppReviewAccount extends Command
{
    protected $signature = 'app-review:account
                            {email : The demo account\'s email address}
                            {--name=Demo Client : The name on the account and its client record}
                            {--client= : Put the account on this client record instead (its uid or exact name)}
                            {--reset-password : Give the existing demo account a new password}';

    protected $description = 'Create the App Review demo account, move it to a client record, or give it a new password';

    public function handle(): int
    {
        $email = Str::lower(trim((string) $this->argument('email')));

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error("{$email} is not an email address.");

            return self::FAILURE;
        }

        $target = null;
        $reference = trim((string) $this->option('client'));
        if ($reference !== '') {
            $error = null;
            $target = $this->findClient($reference, $error);

            if ($target === null) {
                $this->error($error);

                return self::FAILURE;
            }
        }

        $user = User::where('email', $email)->first();

        if ($user !== null) {
            if (! Role::isClient($user)) {
                $this->error("{$email} belongs to a {$user->account_type} account. Only a client account can be the demo account.");

                return self::FAILURE;
            }

            if ($target !== null && ! $this->linkable($target, $user)) {
                return self::FAILURE;
            }

            if ($target === null && ! $this->option('reset-password')) {
                $this->info("{$email} already has an account. Pass --reset-password to give it a new password, or --client to move it to another client record.");
                $this->warnings($user);

                return self::SUCCESS;
            }

            if ($target !== null) {
                $this->moveTo($user, $target);
            }

            if ($this->option('reset-password')) {
                $password = $this->newPassword();
                $user->forceFill(['password' => $password])->save();

                $this->info("New password for {$email}:");
                $this->line($password);
            }

            $this->warnings($user);

            return self::SUCCESS;
        }

        if ($target !== null && ! $this->linkable($target, null)) {
            return self::FAILURE;
        }

        $name = trim((string) $this->option('name')) ?: 'Demo Client';
        $password = $this->newPassword();

        $user = DB::transaction(function () use ($email, $name, $password, $target) {
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

            $client = $target ?? Client::query()
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

    /** By uid first, then by exact name when exactly one record carries it. */
    private function findClient(string $reference, ?string &$error): ?Client
    {
        $client = Client::where('uid', $reference)->first();

        if ($client === null) {
            $named = Client::whereRaw('lower(name) = ?', [Str::lower($reference)])->get();

            if ($named->count() > 1) {
                $error = "More than one client record is named \"{$reference}\". Pass its uid instead: "
                    .$named->pluck('uid')->implode(', ').'.';

                return null;
            }

            $client = $named->first();
        }

        if ($client === null) {
            $error = "No client record has the uid or name \"{$reference}\".";
        }

        return $client;
    }

    /** A record with somebody else's login stays theirs. */
    private function linkable(Client $client, ?User $user): bool
    {
        if ($client->user_id === null || ($user !== null && $client->user_id === $user->id)) {
            return true;
        }

        $this->error("The client record \"{$client->name}\" already has a login of its own. Pick a record nobody signs in to, such as the main applicant's record of a sample application.");

        return false;
    }

    private function moveTo(User $user, Client $target): void
    {
        DB::transaction(function () use ($user, $target) {
            Client::where('user_id', $user->id)
                ->whereKeyNot($target->id)
                ->get()
                ->each(fn (Client $old) => $old->forceFill(['user_id' => null])->save());

            $target->forceFill(['user_id' => $user->id])->save();

            ClientConversations::attachLogin($user);
        });

        $count = CipApplication::where('client_id', $target->id)->count();
        $this->info("{$user->email} now signs in to the client record \"{$target->name}\" ({$target->uid}), which has {$count} "
            .Str::plural('application', $count).'.');
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
