<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A poll attached to a post, its options, and the votes cast.
     *
     * `is_anonymous` hides *who* voted, never the tally — an anonymous poll
     * still stores the voter id, because without it the same person could vote
     * repeatedly and the result would be worthless. The presenter is what
     * refuses to name them; the guarantee is enforced there and in the
     * controller, not by discarding the data.
     *
     * `votes_count` on an option is denormalised so live results redraw from
     * the poll alone rather than aggregating every vote on each render.
     */
    public function up(): void
    {
        Schema::create('feed_polls', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('post_id')->constrained('feed_posts')->cascadeOnDelete();

            $table->string('question');
            // When true a voter may select several options; the unique key on
            // votes is per option, so multi-select needs no schema change.
            $table->boolean('multiple_choice')->default(false);
            $table->boolean('is_anonymous')->default(false);
            // Voting stops at this moment. Null means it stays open.
            $table->timestamp('closes_at')->nullable();
            // Set when closed early by hand, so "closed by the author" and
            // "closed because time ran out" stay distinguishable.
            $table->timestamp('closed_at')->nullable();
            // Hide the tally from voters until the poll closes.
            $table->boolean('hide_results_until_closed')->default(false);

            $table->unsignedInteger('votes_count')->default(0);

            $table->timestamps();

            $table->index('post_id');
            // What the closing sweep looks for.
            $table->index(['closes_at', 'closed_at']);
        });

        Schema::create('feed_poll_options', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('poll_id')->constrained('feed_polls')->cascadeOnDelete();

            $table->string('label', 255);
            $table->unsignedSmallInteger('position')->default(0);
            $table->unsignedInteger('votes_count')->default(0);

            $table->timestamps();

            $table->index(['poll_id', 'position']);
        });

        Schema::create('feed_poll_votes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('poll_id')->constrained('feed_polls')->cascadeOnDelete();
            $table->foreignId('option_id')->constrained('feed_poll_options')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            $table->timestamps();

            // One vote per person per option. A single-choice poll is enforced
            // in the controller by clearing the previous vote first; this index
            // is what stops a double-submit from counting twice either way.
            $table->unique(['option_id', 'user_id']);
            $table->index(['poll_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_poll_votes');
        Schema::dropIfExists('feed_poll_options');
        Schema::dropIfExists('feed_polls');
    }
};
