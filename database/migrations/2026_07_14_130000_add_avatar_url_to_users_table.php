<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Holds either a provider photo URL (https://…) or the name of one of
        // the system avatars in public/images/avatars.
        if (Schema::hasColumn('users', 'avatar_url')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_url', 2048)->nullable()->after('admin_note');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('avatar_url');
        });
    }
};
