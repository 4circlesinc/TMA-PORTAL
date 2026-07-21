<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Emoji reactions, and the per-user star ("saved message") flag.
     *
     * A user may react with several different emoji to the same message but
     * only once with each, which the unique index enforces - tapping the same
     * emoji again removes the row rather than adding a second one.
     */
    public function up(): void
    {
        Schema::create('message_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // The emoji itself, stored as the literal character sequence so no
            // shortcode table is needed to render it back.
            $table->string('emoji', 32);
            $table->timestamps();

            $table->unique(['message_id', 'user_id', 'emoji']);
            $table->index('message_id');
        });

        Schema::create('message_stars', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['message_id', 'user_id']);
            // "Starred messages" in the conversation info panel.
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_stars');
        Schema::dropIfExists('message_reactions');
    }
};
