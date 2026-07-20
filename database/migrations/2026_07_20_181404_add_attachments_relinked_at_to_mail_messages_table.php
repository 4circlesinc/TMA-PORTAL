<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mail_messages', function (Blueprint $table) {
            // Set the first time a message's attachments are re-derived under
            // the corrected is_inline heuristic (a bare Content-ID no longer
            // means inline - see GmailProvider::resolveInlineAttachments()).
            // Without this marker, a message whose real attachments are all
            // genuinely embedded images would fail the "any non-inline
            // attachment exists" check on every open forever, and MailController
            // ::show() would re-fetch it from the provider every single time
            // instead of caching after the first corrective pass.
            $table->timestamp('attachments_relinked_at')->nullable()->after('has_attachments');
        });
    }

    public function down(): void
    {
        Schema::table('mail_messages', function (Blueprint $table) {
            $table->dropColumn('attachments_relinked_at');
        });
    }
};
