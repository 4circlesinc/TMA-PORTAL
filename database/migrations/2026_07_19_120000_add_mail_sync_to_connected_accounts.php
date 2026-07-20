<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            // Where the last sync stopped. Gmail stores a historyId; Graph
            // stores a full deltaLink URL — hence text, not a string.
            $table->text('mail_cursor')->nullable()->after('sync_sharepoint');
            $table->timestamp('mail_synced_at')->nullable()->after('mail_cursor');
            // idle | syncing | error — surfaced in the mailbox settings panel
            // so a broken token is visible instead of looking like empty mail.
            $table->string('mail_status', 20)->default('idle')->after('mail_synced_at');
            $table->text('mail_error')->nullable()->after('mail_status');
        });
    }

    public function down(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            $table->dropColumn(['mail_cursor', 'mail_synced_at', 'mail_status', 'mail_error']);
        });
    }
};
