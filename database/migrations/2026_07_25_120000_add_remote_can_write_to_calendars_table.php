<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Whether the remote provider calendar itself accepts writes.
     *
     * Distinct from account scopes: a Google Holidays calendar is read-only
     * even when the account has Calendars.ReadWrite. Null means unknown
     * (connected before this column existed).
     */
    public function up(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            $table->boolean('remote_can_write')->nullable()->after('sync_cancelled');
        });
    }

    public function down(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            $table->dropColumn('remote_can_write');
        });
    }
};
