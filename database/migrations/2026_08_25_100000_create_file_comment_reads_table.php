<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How far each reader has got in each comment thread.
 *
 * WHY THIS EXISTS
 *
 * Every indicator the portal drew about comments was really about *state*, not
 * about the reader: a dot meant "this thread is unresolved", and the Workflows
 * count meant "somebody typed your name". Neither ever changed because you read
 * something, so a badge that appeared could only be cleared by resolving work,
 * and a thread you started and somebody answered never counted at all.
 *
 * This is the missing half. One row per reader per thread, holding the last
 * comment in it they have seen — the same shape
 * `conversation_participants.last_read_message_id` uses for chat, so "unread"
 * means the same thing in both places.
 *
 * BY THREAD, NOT BY FILE
 *
 * A file can carry several conversations at once. Marking the whole file read
 * because somebody glanced at one of them would bury a new reply in another,
 * which is the failure this table exists to prevent.
 *
 * BY ID, NOT BY TIME
 *
 * Comment ids are monotonic; timestamps are not reliably distinct — a burst of
 * replies inside one second would order arbitrarily against a `read_at`, and
 * the reader would be told they had missed something they had just read.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_comment_reads', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // The thread's root comment. Cascades, so purging a thread takes
            // every reader's marker with it rather than leaving orphans that
            // would count as "unread" for ever.
            $table->foreignId('root_id')->constrained('file_comments')->cascadeOnDelete();

            $table->unsignedBigInteger('last_read_comment_id');

            $table->timestamps();

            // One marker per reader per thread; the upsert on read depends on it.
            $table->unique(['user_id', 'root_id']);

            // "Everything this reader has read", which is how the unread count
            // and the row indicators join against it.
            $table->index(['user_id', 'last_read_comment_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_comment_reads');
    }
};
