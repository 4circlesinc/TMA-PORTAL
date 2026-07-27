<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks the highest unread-message reminder email already sent to a
 * participant for their current unread streak (0 none, 1 = ~1h, 2 = ~20h,
 * 3 = ~24h). Reset to 0 when they read, so the next streak starts fresh.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->unsignedTinyInteger('reminder_tier')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->dropColumn('reminder_tier');
        });
    }
};
