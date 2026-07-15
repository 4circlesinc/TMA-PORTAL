<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('first_name')->nullable()->after('name');
            $table->string('middle_name')->nullable()->after('first_name');
            $table->string('last_name')->nullable()->after('middle_name');
        });

        // Split existing display names: first word, last word, rest in between.
        User::query()->whereNull('first_name')->get()->each(function (User $user) {
            $parts = preg_split('/\s+/', trim((string) $user->name), -1, PREG_SPLIT_NO_EMPTY) ?: [];

            $user->forceFill([
                'first_name' => array_shift($parts) ?: $user->name,
                'last_name' => count($parts) ? array_pop($parts) : null,
                'middle_name' => count($parts) ? implode(' ', $parts) : null,
            ])->save();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['first_name', 'middle_name', 'last_name']);
        });
    }
};
