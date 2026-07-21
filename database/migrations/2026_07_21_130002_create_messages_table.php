<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One row per message. Deletes are soft so a removed message can still be
     * rendered as a "this message was deleted" placeholder in the thread, and
     * so replies pointing at it keep resolving.
     *
     * System messages (someone joined, the group was renamed) have no sender
     * and carry their detail in `system_event`, letting the UI phrase them
     * without the server building display strings.
     */
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            // Null for system messages, and for a member whose account is gone.
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            // text | voice | attachment | system
            $table->string('type', 16)->default('text');
            // Plain text as the author typed it. Never HTML: the client escapes
            // it and linkifies at render time, so stored content is inert.
            $table->text('body')->nullable();

            // Reply target. nullOnDelete rather than cascade so hard-deleting a
            // parent can never take unrelated replies with it.
            $table->foreignId('reply_to_id')->nullable()->references('id')->on('messages')->nullOnDelete();

            // Set once the author edits, so the UI can show "edited".
            $table->timestamp('edited_at')->nullable();
            // Detail for type='system': {"event":"member_added","actor":1,...}
            $table->jsonb('system_event')->nullable();

            // Client-generated id for an optimistic send. Lets a retry, or the
            // sender's own broadcast echo, be recognised instead of duplicated.
            $table->uuid('client_nonce')->nullable();

            $table->timestamps();
            $table->softDeletes();

            // Paging a thread: newest-first within one conversation.
            $table->index(['conversation_id', 'id']);
            $table->unique(['conversation_id', 'client_nonce']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
