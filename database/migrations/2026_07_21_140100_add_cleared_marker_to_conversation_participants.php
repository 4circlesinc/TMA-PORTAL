<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Personal "clear chat" marker.
     *
     * Clearing a conversation hides everything up to this message *for this
     * participant only* — the other side keeps their copy. Storing a marker
     * rather than deleting rows is what makes that possible, and it means a
     * clear can never destroy someone else's history.
     */
    public function up(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->unsignedBigInteger('cleared_before_message_id')
                ->nullable()
                ->after('last_read_at');
        });
    }

    public function down(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->dropColumn('cleared_before_message_id');
        });
    }
};
