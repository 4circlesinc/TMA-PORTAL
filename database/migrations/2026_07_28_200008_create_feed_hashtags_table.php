<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Hashtags, and which posts carry them.
     *
     * A tag is stored once and folded to lower case, so #Q3 and #q3 are the
     * same topic; `display_tag` keeps the casing it was first written with so
     * the chip reads the way its author typed it. The alternative — matching
     * `body_text LIKE '%#tag%'` — would also match a tag inside a code block
     * or a URL fragment, which is exactly the false positive a topic index
     * cannot afford.
     */
    public function up(): void
    {
        Schema::create('feed_hashtags', function (Blueprint $table) {
            $table->id();
            // Lower case, no leading '#'.
            $table->string('tag', 80)->unique();
            // The casing it was first written with, for display.
            $table->string('display_tag', 80);
            $table->unsignedInteger('posts_count')->default(0);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            // The "trending / most used" list.
            $table->index('posts_count');
        });

        Schema::create('feed_post_hashtag', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('hashtag_id')->constrained('feed_hashtags')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['post_id', 'hashtag_id']);
            $table->index('hashtag_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_post_hashtag');
        Schema::dropIfExists('feed_hashtags');
    }
};
