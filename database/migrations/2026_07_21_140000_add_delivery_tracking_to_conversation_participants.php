<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Delivery high-water mark, the counterpart to `last_read_message_id`.
     *
     * The chat list already tracked "read"; this adds the middle state every
     * messenger shows. Delivered means the recipient's client has *received*
     * the message (a socket event, or a load that included it) — not that they
     * have opened the conversation. That distinction is what separates the two
     * grey ticks from the two blue ones.
     *
     * Stored as a mark rather than a row per message for the same reason reads
     * are: a sender's tick is then one integer compare.
     */
    public function up(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->unsignedBigInteger('last_delivered_message_id')->nullable()->after('role');
            $table->timestamp('last_delivered_at')->nullable()->after('last_delivered_message_id');
        });
    }

    public function down(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->dropColumn(['last_delivered_message_id', 'last_delivered_at']);
        });
    }
};
