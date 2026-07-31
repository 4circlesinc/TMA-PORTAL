<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A comment on a file, and — through `parent_id` — a reply to one.
     *
     * Threading is one level deep, the same shape the Feed settled on: a reply
     * to a reply is stored against the same top-level parent, so a thread stays
     * a readable pair of columns rather than an unbounded indent. `root_id` is
     * the top-level comment either way, which is what lets a whole thread load
     * in one query instead of being walked recursively.
     *
     * Mentions get their own table rather than a JSON column on the comment:
     * "everything addressed to me" has to be an indexed lookup, and a JSON blob
     * cannot be joined or counted.
     */
    public function up(): void
    {
        Schema::create('file_comments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('file_id')->constrained('files')->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('parent_id')->nullable()
                ->constrained('file_comments')->cascadeOnDelete();
            $table->foreignId('root_id')->nullable()
                ->constrained('file_comments')->cascadeOnDelete();

            // Plain text. Mentions are recorded in file_comment_mentions rather
            // than encoded as markup, so nothing user-written is ever rendered
            // as HTML.
            $table->text('body');

            $table->timestamp('edited_at')->nullable();

            // Resolved threads stay readable but drop out of the open count.
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()
                ->constrained('users')->nullOnDelete();

            $table->unsignedInteger('replies_count')->default(0);

            // Deleting keeps the row so replies beneath it don't vanish; the
            // body is blanked by the application when it happens.
            $table->softDeletes();
            $table->foreignId('deleted_by')->nullable()
                ->constrained('users')->nullOnDelete();

            $table->timestamps();

            // The panel's own query: this file's top-level thread, newest last.
            $table->index(['file_id', 'root_id', 'created_at']);
            $table->index(['file_id', 'resolved_at']);
            $table->index('parent_id');
            $table->index('author_id');
        });

        Schema::create('file_comment_mentions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('comment_id')->constrained('file_comments')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['comment_id', 'user_id']);
            // "Everything that named me, newest first."
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_comment_mentions');
        Schema::dropIfExists('file_comments');
    }
};
