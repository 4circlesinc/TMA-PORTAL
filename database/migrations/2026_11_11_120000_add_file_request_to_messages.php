<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A chat message that asks for files.
 *
 * "/" then Request files in any chat writes a message of type file_request
 * pointing at the file request it opened: an application's checklist
 * documents, or files for a folder. The bubble draws that request (each
 * document with its own upload button) from this link, and it follows the
 * request as files arrive. Deleting the request leaves the message standing
 * with nothing to draw, rather than taking the conversation's history with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->foreignId('file_request_id')->nullable()->after('reply_to_id')
                ->constrained('file_requests')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('file_request_id');
        });
    }
};
