<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The conversation beside one checklist row (§12).
 *
 * A separate table from file_comments rather than a column added to it: a
 * thread here is about the *requirement* — "this bio page expires in March,
 * send the renewed one" — and the slot is what stays put while the file inside
 * it is replaced version after version. Hanging the thread off the file would
 * scatter one conversation across every upload that answered the question, and
 * lose it entirely for a slot nobody has filled yet, which is exactly when
 * there is most to say.
 *
 * Threading is one level deep, the shape file comments and the Feed both
 * settled on: a reply to a reply is stored against the same top-level parent,
 * and `root_id` is that top-level comment either way, so a whole thread loads
 * in one query instead of being walked.
 *
 * `parent_id` and `root_id` null on delete rather than cascade, which is where
 * this parts company with file_comments. On a citizenship file a reply is the
 * record of what was asked and answered; removing the comment it hung under
 * must leave it standing on its own, not take it away with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_document_comments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('document_id')->constrained('cip_documents')->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('parent_id')->nullable()
                ->constrained('cip_document_comments')->nullOnDelete();
            $table->foreignId('root_id')->nullable()
                ->constrained('cip_document_comments')->nullOnDelete();

            // Plain text. Nothing user-written is ever rendered as HTML.
            $table->text('body');

            $table->timestamp('edited_at')->nullable();

            // Resolved threads stay readable but drop out of the open count —
            // the number the checklist row shows is what is still outstanding.
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()
                ->constrained('users')->nullOnDelete();

            $table->unsignedInteger('replies_count')->default(0);

            $table->timestamps();

            // Deleting keeps the row so replies beneath it don't vanish; the
            // body is blanked by the application when it happens.
            $table->softDeletes();
            $table->foreignId('deleted_by')->nullable()
                ->constrained('users')->nullOnDelete();

            // The panel's own query: this slot's top-level thread, newest last.
            $table->index(['document_id', 'root_id', 'created_at']);
            $table->index(['document_id', 'resolved_at']);
            $table->index('parent_id');
            $table->index('author_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_document_comments');
    }
};
