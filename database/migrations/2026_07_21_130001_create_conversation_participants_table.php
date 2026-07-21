<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Membership of a conversation, and everything about it that is personal
     * to one participant: their pin/archive/mute state, their unsent draft,
     * and how far they have read.
     *
     * This table is also the authorization boundary. A user may only read a
     * conversation they hold a row here for, with `left_at` still null - every
     * messaging endpoint checks that before returning anything.
     */
    public function up(): void
    {
        Schema::create('conversation_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Group administrators may rename, set the photo, and add/remove
            // members. In a direct thread both sides are plain members.
            $table->string('role', 16)->default('member');

            // Read state. Storing the high-water mark rather than a row per
            // message keeps receipts to one integer compare: a message of mine
            // is "read" by someone when their last_read_message_id >= its id.
            $table->unsignedBigInteger('last_read_message_id')->nullable();
            $table->timestamp('last_read_at')->nullable();
            // Set when the user explicitly marks a conversation unread again,
            // so it stays bold even though last_read_message_id is current.
            $table->timestamp('marked_unread_at')->nullable();

            // Per-user conversation state, all nullable = "off".
            $table->timestamp('pinned_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamp('muted_until')->nullable();

            // The composer's unsent text, kept per conversation per user so
            // switching threads can never carry one draft into another.
            $table->text('draft')->nullable();
            $table->timestamp('draft_updated_at')->nullable();

            $table->timestamp('joined_at')->nullable();
            // Soft membership end: a member who left a group keeps their rows
            // in place so their past messages still resolve to a sender.
            $table->timestamp('left_at')->nullable();
            $table->timestamps();

            $table->unique(['conversation_id', 'user_id']);
            // "My conversations" - the chat list's driving query.
            $table->index(['user_id', 'left_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conversation_participants');
    }
};
