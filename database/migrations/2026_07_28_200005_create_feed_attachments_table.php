<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A file attached to a post or a comment.
     *
     * Bytes live in the File Library's vault (App\Support\Files\Vault), on the
     * same disk everything else durable is written to, and the disk is saved
     * per row so files uploaded before a disk switch keep resolving. Nothing
     * here is served from a public URL: the download route re-checks channel
     * access on every request.
     *
     * Like message attachments, a file is staged *before* the post exists —
     * the composer has to show a preview, a size and a remove button while the
     * post is still being written, and a failed upload must not take the typed
     * body with it. So `post_id` is nullable and a staged row is identified by
     * its channel and uploader until a post claims it on save.
     */
    public function up(): void
    {
        Schema::create('feed_attachments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            // Exactly one of these is set once the file is claimed.
            $table->foreignId('post_id')->nullable()
                ->constrained('feed_posts')->cascadeOnDelete();
            $table->foreignId('comment_id')->nullable()
                ->constrained('feed_comments')->cascadeOnDelete();
            // Denormalised so staged rows — which have no post yet — can still
            // be scoped, and so a channel's media shelf is one query.
            $table->foreignId('channel_id')->nullable()
                ->constrained('feed_channels')->cascadeOnDelete();
            $table->foreignId('uploaded_by')->nullable()
                ->constrained('users')->nullOnDelete();

            $table->string('disk', 32);
            $table->string('path');
            $table->string('name');
            $table->string('mime', 191)->nullable();
            // Kept alongside the mime so the file-type icon and the "can this
            // be previewed" decision match the File Library's rules exactly.
            $table->string('extension', 32)->nullable();
            $table->unsignedBigInteger('size')->default(0);

            // Set for images and video, so a card reserves the right box before
            // the file loads and the stream doesn't jump while scrolling.
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->string('thumb_path')->nullable();

            // staged — uploaded, not yet claimed by a post or comment
            // ready  — claimed
            $table->string('status', 16)->default('staged');

            $table->timestamps();
            $table->softDeletes();

            $table->index('post_id');
            $table->index('comment_id');
            // Staged rows are found by owner; ready rows by channel.
            $table->index(['uploaded_by', 'status']);
            $table->index(['channel_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_attachments');
    }
};
