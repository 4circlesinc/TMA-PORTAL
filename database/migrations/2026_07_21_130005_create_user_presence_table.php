<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Presence and blocking.
     *
     * Presence is written often and read constantly, so only the durable part
     * lives here: `last_seen_at`, which has to survive a restart for "last seen
     * yesterday" to be true. Live online/typing/recording state is transient
     * and rides the websocket instead of this table.
     *
     * Whether any of it is visible to a given viewer is a privacy decision made
     * at read time from the user's own settings (users.preferences), never by
     * withholding the write.
     */
    public function up(): void
    {
        Schema::create('user_presence', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->timestamp('last_seen_at')->nullable();
            // Bumped by the heartbeat; a user counts as online while this is
            // recent. Kept as a column so a missed disconnect still expires.
            $table->timestamp('online_until')->nullable();
            $table->timestamps();

            $table->index('online_until');
        });

        Schema::create('user_blocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('blocked_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'blocked_user_id']);
            // Checked on every send, so index the direction we look up.
            $table->index('blocked_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('user_presence');
    }
};
