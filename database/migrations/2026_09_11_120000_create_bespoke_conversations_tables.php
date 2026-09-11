<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Past chats for Bespoke AI Assistant. Each row belongs to one signed-in
 * user; another account must not be able to read it. Message bodies live
 * here so the /bespoke-ai page can reopen a thread. Activity logs still
 * never store the prompt text.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bespoke_conversations', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 80)->default('New chat');
            $table->string('preview', 120)->nullable();
            $table->timestamp('last_message_at')->nullable()->index();
            $table->timestamps();

            $table->index(['user_id', 'last_message_at']);
        });

        Schema::create('bespoke_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained('bespoke_conversations')->cascadeOnDelete();
            $table->string('role', 16);
            $table->text('body');
            $table->timestamps();

            $table->index(['conversation_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bespoke_messages');
        Schema::dropIfExists('bespoke_conversations');
    }
};
