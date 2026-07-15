<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            // Encrypted OAuth refresh token + the scopes the user granted, so a
            // later email/calendar feature can act on their behalf. Captured
            // only when the user opts into syncing.
            $table->text('token')->nullable()->after('name');
            $table->json('scopes')->nullable()->after('token');
            $table->boolean('sync_email')->default(false)->after('scopes');
            $table->boolean('sync_calendar')->default(false)->after('sync_email');
        });
    }

    public function down(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            $table->dropColumn(['token', 'scopes', 'sync_email', 'sync_calendar']);
        });
    }
};
