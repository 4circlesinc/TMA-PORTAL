<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A comment on a post, and — through `parent_id` — a reply to a comment.
     *
     * Threading is deliberately one level deep. A reply to a reply is stored
     * against the same top-level parent, so a thread stays a readable pair of
     * columns instead of an unbounded indent. `root_id` is the top-level
     * comment either way, which is what lets a whole thread be loaded in one
     * query rather than walked recursively.
     */
    public function up(): void
    {
        Schema::create('feed_comments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('post_id')->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users')->cascadeOnDelete();
            // The comment being replied to. Null for a top-level comment.
            $table->foreignId('parent_id')->nullable()
                ->constrained('feed_comments')->cascadeOnDelete();
            // The top-level comment of this thread — itself, when top-level.
            $table->foreignId('root_id')->nullable()
                ->constrained('feed_comments')->cascadeOnDelete();

            $table->text('body')->nullable();
            $table->text('body_text')->nullable();

            $table->timestamp('edited_at')->nullable();
            $table->unsignedInteger('reactions_count')->default(0);
            $table->unsignedInteger('replies_count')->default(0);

            $table->timestamps();
            $table->softDeletes();

            // Loading a post's comment tree: one post, oldest first.
            $table->index(['post_id', 'root_id', 'created_at']);
            $table->index('author_id');
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_comments');
    }
};
