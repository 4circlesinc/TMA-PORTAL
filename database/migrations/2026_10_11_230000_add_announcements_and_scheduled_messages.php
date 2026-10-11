<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * An announcement is an ordinary message its group's admins marked
         * as one: same thread, same replies and reactions, drawn apart and
         * told to everyone. A flag rather than a type, because the type
         * already says what the message carries (text, a file, a voice note).
         */
        Schema::table('messages', function (Blueprint $table) {
            $table->boolean('is_announcement')->default(false);
        });

        /*
         * Messages waiting for their time. Kept out of `messages` so nothing
         * that reads a thread has to know to leave them out: a row here
         * becomes a message, by its author, when `send_at` arrives.
         */
        Schema::create('scheduled_messages', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('body');
            $table->boolean('is_announcement')->default(false);
            $table->timestamp('send_at');
            $table->timestamp('sent_at')->nullable();
            $table->foreignId('message_id')->nullable()->constrained('messages')->nullOnDelete();
            // Could not be posted when its time came, and why.
            $table->timestamp('failed_at')->nullable();
            $table->string('failed_reason')->nullable();
            $table->timestamps();

            $table->index(['sent_at', 'failed_at', 'send_at']);
            $table->index(['conversation_id', 'sent_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scheduled_messages');

        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn('is_announcement');
        });
    }
};
