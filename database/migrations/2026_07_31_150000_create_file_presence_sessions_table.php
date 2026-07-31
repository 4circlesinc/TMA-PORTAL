<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Who currently has a file open.
     *
     * Keyed by SESSION, not by user: the same person with the document open in
     * two tabs is two sessions, and closing one must not claim they have left.
     *
     * "Online" is never stored as a flag — it is derived from `last_heartbeat_at`
     * being recent, exactly as user_presence does it. A tab that closes without
     * telling us simply stops renewing and ages out on its own, which is the
     * only way this can stay honest. §13 is explicit that presence must not be
     * inferred from historic activity.
     */
    public function up(): void
    {
        Schema::create('file_presence_sessions', function (Blueprint $table) {
            $table->id();

            $table->foreignId('file_id')->constrained('files')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('session_id', 64);

            // viewing | editing | commenting — what they are doing right now.
            $table->string('action', 16)->default('viewing');
            $table->string('device', 40)->nullable();

            $table->timestamp('opened_at');
            $table->timestamp('last_heartbeat_at');

            $table->timestamps();

            $table->unique(['file_id', 'session_id']);
            // The panel's own query: who is on this file, most recent first.
            $table->index(['file_id', 'last_heartbeat_at']);
            $table->index('last_heartbeat_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_presence_sessions');
    }
};
