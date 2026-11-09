<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Reminders for outstanding file requests.
 *
 * Each request carries how often its recipient is reminded while nothing it
 * asked for has arrived (null or 0: never), when the last reminder went, and
 * how many have gone — so a request is never reminded more often than it
 * says, nor without end. The default, and whether anybody but an
 * administrator may choose a different one, is the firm's: FileLibrarySetting
 * (requestReminderDays, requestReminderChoosable).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('file_requests', function (Blueprint $table) {
            $table->unsignedSmallInteger('reminder_every_days')->nullable();
            $table->timestamp('reminded_at')->nullable();
            $table->unsignedSmallInteger('reminders_sent')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('file_requests', function (Blueprint $table) {
            $table->dropColumn(['reminder_every_days', 'reminded_at', 'reminders_sent']);
        });
    }
};
