<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed an approved administrator so the portal is never locked out.
     * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD in .env.
     */
    public function run(): void
    {
        $email = str(env('ADMIN_EMAIL', 'vfrancis@tmantoinelaw.com'))->lower()->toString();

        if (User::where('email', $email)->exists()) {
            $this->command?->info("Admin {$email} already exists - skipped.");

            return;
        }

        $password = env('ADMIN_PASSWORD') ?: Str::password(16);

        $user = new User([
            'name' => 'Vernon Francis',
            'email' => $email,
            'password' => $password,
        ]);

        $user->forceFill([
            'email_verified_at' => now(),
            'status' => User::STATUS_APPROVED,
            'approved_at' => now(),
            'account_type' => 'Administrator',
        ])->save();

        $this->command?->info("Admin account: {$email}");

        if (! env('ADMIN_PASSWORD')) {
            $this->command?->warn("Generated password: {$password} (set ADMIN_PASSWORD in .env to control this)");
        }
    }
}
