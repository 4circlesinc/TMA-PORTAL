<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Who a group message addresses: a member by name, or everyone with @all.
     *
     * A table rather than a column on the message, for the same reason file
     * comments keep theirs apart: "is there something addressed to me that I
     * have not read" is asked for every row of the chat list, and has to be
     * one indexed lookup.
     */
    public function up(): void
    {
        Schema::create('message_mentions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            // Repeated from the message so the chat list's lookup never has to
            // join the messages table to learn which conversation this is in.
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            // Null is everyone: @all.
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            // The name as it was written. The bubble highlights this text, so
            // a person renamed later is still highlighted in what was said.
            $table->string('label', 160);
            $table->timestamps();

            $table->unique(['message_id', 'user_id']);
            $table->index(['conversation_id', 'user_id', 'message_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_mentions');
    }
};
