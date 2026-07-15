<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Per-user personal settings (time zone, language, voice, …) so they
            // persist to the account and follow the user across devices, instead
            // of living only in one browser's localStorage.
            $table->json('preferences')->nullable()->after('provider_avatar_url');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('preferences');
        });
    }
};
