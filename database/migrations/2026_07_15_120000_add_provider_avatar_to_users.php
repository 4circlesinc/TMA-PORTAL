<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // The last photo a provider (Google/Microsoft) supplied, kept
            // separately so a user can switch back to it after uploading.
            $table->string('provider_avatar_url', 2048)->nullable()->after('avatar_url');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('provider_avatar_url');
        });
    }
};
