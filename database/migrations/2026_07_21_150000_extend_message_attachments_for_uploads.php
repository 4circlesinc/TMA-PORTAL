<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Make message attachments uploadable before their message exists.
     *
     * The composer has to show a preview, a size, a progress bar and a remove
     * button *before* anything is sent, and a failed upload must not take the
     * typed text with it. That means the file is stored first and the message
     * claims it on send — so `message_id` becomes nullable and a staged row is
     * identified by its conversation and uploader instead.
     *
     * `conversation_id` is denormalised deliberately: the shared-media gallery
     * lists every attachment in a conversation, and staged rows have no message
     * to join through.
     */
    public function up(): void
    {
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->foreignId('conversation_id')->nullable()->after('uuid')
                ->constrained()->cascadeOnDelete();
            $table->foreignId('uploaded_by')->nullable()->after('conversation_id')
                ->constrained('users')->nullOnDelete();

            // Kept alongside the mime so the file-type icon and the "is this
            // previewable" decision match the File Library's rules exactly.
            $table->string('extension', 32)->nullable()->after('mime');

            // staged  — uploaded, not yet attached to a sent message
            // ready   — attached to a sent message
            // failed  — upload did not complete; kept only to report it
            $table->string('status', 16)->default('ready')->after('extension');

            // Staged rows are found by owner; ready rows by conversation.
            $table->index(['conversation_id', 'status']);
            $table->index(['uploaded_by', 'status']);
        });

        // A staged attachment has no message yet.
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->unsignedBigInteger('message_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('conversation_id');
            $table->dropConstrainedForeignId('uploaded_by');
            $table->dropColumn(['extension', 'status']);
        });
    }
};
