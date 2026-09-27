<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Emoji reactions on an application's messaging centre.
 *
 * Same rule as chat: one row per person per emoji, and tapping that emoji
 * again removes it. The message itself is not a chat message, so the rows
 * live with the file thread rather than on message_reactions.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_application_message_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained('cip_application_messages')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('emoji', 32);
            $table->timestamps();

            $table->unique(['message_id', 'user_id', 'emoji']);
            $table->index('message_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_application_message_reactions');
    }
};
