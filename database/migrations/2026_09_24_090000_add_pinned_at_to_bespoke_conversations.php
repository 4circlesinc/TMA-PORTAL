<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A chat the reader wants to keep to hand.
 *
 * The history list is ordered by when a chat was last spoken to, which is
 * the right default and the wrong one for the two or three threads somebody
 * returns to all week. Pinned chats sit above the date groups in their own
 * section, so the grouping below stays purely chronological.
 *
 * A timestamp rather than a flag: it says when, so pinned chats order among
 * themselves by most recently pinned without another column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bespoke_conversations', function (Blueprint $table) {
            $table->timestamp('pinned_at')->nullable()->after('last_message_at');
            $table->index(['user_id', 'pinned_at']);
        });
    }

    public function down(): void
    {
        Schema::table('bespoke_conversations', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'pinned_at']);
            $table->dropColumn('pinned_at');
        });
    }
};
