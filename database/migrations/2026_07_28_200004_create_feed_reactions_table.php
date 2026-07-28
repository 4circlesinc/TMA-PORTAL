<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An emoji reaction on a post or a comment.
     *
     * One row per person per target, not per emoji: the unique key is
     * (target, user), so reacting again *changes* the reaction rather than
     * adding a second one, and reacting with the emoji already chosen removes
     * it. That is the behaviour §10 asks for — add, change, remove — and
     * enforcing it in the index means a double-click cannot leave two rows.
     *
     * The target is polymorphic over posts and comments only. Storing the
     * model class rather than two nullable foreign keys keeps the "who
     * reacted" popover a single query no matter what was reacted to.
     */
    public function up(): void
    {
        Schema::create('feed_reactions', function (Blueprint $table) {
            $table->id();
            // 'post' | 'comment'
            $table->string('reactable_type', 16);
            $table->unsignedBigInteger('reactable_id');
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // The emoji itself, not a shortcode — what is stored is what is
            // rendered, so a new emoji needs no server change.
            $table->string('emoji', 32);

            $table->timestamps();

            $table->unique(['reactable_type', 'reactable_id', 'user_id']);
            // Grouping a target's reactions by emoji for the summary row.
            $table->index(['reactable_type', 'reactable_id', 'emoji']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_reactions');
    }
};
