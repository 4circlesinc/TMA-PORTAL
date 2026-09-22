<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The first moment each person saw a message.
 *
 * A read cursor only remembers how far someone has got, and the clock on that
 * row moves again the next time they catch up. That cannot say when they saw
 * an earlier message. One row here is written the first time a message passes
 * under their cursor and is never moved.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained('conversations')->cascadeOnDelete();
            $table->foreignId('message_id')->constrained('messages')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('seen_at');

            $table->unique(['message_id', 'user_id']);
            $table->index(['conversation_id', 'user_id']);
        });

        Schema::create('cip_application_message_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->foreignId('message_id')->constrained('cip_application_messages')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('seen_at');

            $table->unique(['message_id', 'user_id']);
            $table->index(['application_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_application_message_receipts');
        Schema::dropIfExists('message_receipts');
    }
};
