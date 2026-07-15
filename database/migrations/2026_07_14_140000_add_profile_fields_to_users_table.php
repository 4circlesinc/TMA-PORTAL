<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('job_title')->nullable()->after('avatar_url');
            $table->text('bio')->nullable()->after('job_title');
            $table->string('linkedin_url', 255)->nullable()->after('bio');
            $table->timestamp('profile_completed_at')->nullable()->after('linkedin_url');
        });

        // Existing accounts have already been through onboarding.
        DB::table('users')->whereNull('profile_completed_at')->update([
            'profile_completed_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['job_title', 'bio', 'linkedin_url', 'profile_completed_at']);
        });
    }
};
