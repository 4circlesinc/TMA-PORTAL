<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The four one-row-per-person-per-post tables: bookmarks, acknowledgements,
     * views, and mentions.
     *
     * They share a migration because they share a shape — a unique pair, no
     * payload beyond a timestamp — and splitting them into four files would
     * say more about the file count than about the model.
     *
     * Views are recorded per person rather than as a bare counter so §19 can
     * answer "reach" (how many distinct people saw it) as well as "views". The
     * counter on feed_posts is kept in step for the card, which needs the
     * number without the join.
     */
    public function up(): void
    {
        Schema::create('feed_bookmarks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['post_id', 'user_id']);
            // The Bookmarks sidebar view: mine, newest first.
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('feed_acknowledgements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('acknowledged_at');
            $table->timestamps();

            $table->unique(['post_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('feed_post_views', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // Bumped on a repeat view; the row is never duplicated, so the row
            // count *is* the reach.
            $table->timestamp('last_viewed_at');
            $table->unsignedInteger('view_count')->default(1);
            $table->timestamps();

            $table->unique(['post_id', 'user_id']);
            $table->index('post_id');
        });

        Schema::create('feed_mentions', function (Blueprint $table) {
            $table->id();
            // The post or comment the mention was written in. Exactly one is set.
            $table->foreignId('post_id')->nullable()
                ->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('comment_id')->nullable()
                ->constrained('feed_comments')->cascadeOnDelete();

            // A mention of a person, or of a group/department that expands to
            // people at notification time. Exactly one is set.
            $table->foreignId('user_id')->nullable()
                ->constrained('users')->cascadeOnDelete();
            $table->foreignId('group_id')->nullable()
                ->constrained('groups')->cascadeOnDelete();

            $table->timestamps();

            // The Mentions sidebar view: everything addressed to me, newest first.
            $table->index(['user_id', 'created_at']);
            $table->index('group_id');
            $table->index('post_id');
            $table->index('comment_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_mentions');
        Schema::dropIfExists('feed_post_views');
        Schema::dropIfExists('feed_acknowledgements');
        Schema::dropIfExists('feed_bookmarks');
    }
};
