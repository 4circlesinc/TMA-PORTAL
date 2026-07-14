<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class ApproveUser extends Command
{
    protected $signature = 'user:approve {email : Email address of the user to approve}
                            {--type=Client : Account type to assign (e.g. Client, Corporate, Administrator)}';

    protected $description = 'Approve a pending user and assign their account type';

    public function handle(): int
    {
        $user = User::where('email', str($this->argument('email'))->lower())->first();

        if (! $user) {
            $this->error('No user found with that email address.');

            return self::FAILURE;
        }

        $user->forceFill([
            'status' => User::STATUS_APPROVED,
            'approved_at' => now(),
            'account_type' => $this->option('type'),
        ])->save();

        $this->info("Approved {$user->email} as {$user->account_type}.");

        return self::SUCCESS;
    }
}
