<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Portal messaging (the /social/messages page). One row per conversation,
     * either a one-to-one thread between two portal users or a named group.
     *
     * `last_message_at` is denormalised from the newest message so the chat
     * list can sort without touching the messages table; it is the only column
     * a plain send has to update.
     */
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            // Public identifier. The UI addresses every conversation by uuid;
            // storage ids are never exposed, matching the rest of the portal.
            $table->uuid('uuid')->unique();
            // 'direct' = exactly two participants, name/photo come from the
            // other person. 'group' = many, with its own name and photo.
            $table->string('type', 16)->default('direct');
            $table->string('name')->nullable();
            $table->string('photo_disk', 32)->nullable();
            $table->string('photo_path')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // The chat list is always "my conversations, newest first".
            $table->index('last_message_at');
            $table->index('type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conversations');
    }
};
