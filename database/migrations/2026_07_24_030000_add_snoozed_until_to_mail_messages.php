<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Snooze is a portal-local reminder, like pinning: no provider API stores it,
 * so it never syncs to Gmail or Graph. While `snoozed_until` is set the
 * message hides from its folder and lives in the virtual Snoozed view; the
 * scheduled wake pass (mail:wake-snoozed) clears it when due and raises the
 * reminder notification. Indexed because the wake query runs every minute.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mail_messages', function (Blueprint $table) {
            $table->timestamp('snoozed_until')->nullable()->after('is_pinned')->index();
        });
    }

    public function down(): void
    {
        Schema::table('mail_messages', function (Blueprint $table) {
            $table->dropColumn('snoozed_until');
        });
    }
};
