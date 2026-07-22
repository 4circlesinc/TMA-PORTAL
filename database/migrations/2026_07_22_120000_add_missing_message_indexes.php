<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two indexes the messages table was missing.
 *
 * Most of the portal's hot columns are already covered — files, folders,
 * conversations, participants, reactions, attachments and mail all carry the
 * indexes their queries need. These two are the gaps:
 *
 *   - `user_id` has no index at all. Postgres, unlike MySQL, does not create one
 *     for a foreign key, so "messages this person sent" is a sequential scan.
 *     The unread count filters on it for every conversation.
 *
 *   - `deleted_at` has no index, even though every read of this table filters on
 *     it — messages are soft-deleted so a removed one can still render as a
 *     placeholder. `files`, `folders` and `clients` already index theirs; this
 *     brings messages in line.
 *
 * Deliberately not added: an index on `created_at`. Threads page on
 * `(conversation_id, id)`, which is already indexed and monotonic with creation
 * time, so a second index would be written on every insert and read by nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->index('user_id');
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropIndex(['user_id']);
            $table->dropIndex(['deleted_at']);
        });
    }
};
