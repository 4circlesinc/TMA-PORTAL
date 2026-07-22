<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Group conversations, and the organization-wide default chat.
     *
     * `is_default` marks a conversation the firm owns rather than any one
     * person: nobody may rename or leave it on a whim, and management is
     * restricted to administrators regardless of participant role. Kept as a
     * flag rather than a separate table because it *is* a conversation —
     * everything about messages, attachments and reactions applies unchanged.
     *
     * `auto_join` means membership follows the staff list rather than being
     * curated. New approved accounts are added on their next visit, so the
     * chat never quietly excludes someone who joined after it was created.
     *
     * `disabled_at` retires a conversation without destroying its history,
     * which is what "archive or disable it" needs to mean for a shared record.
     */
    public function up(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->text('description')->nullable()->after('name');
            $table->boolean('is_default')->default(false)->after('description');
            $table->boolean('auto_join')->default(false)->after('is_default');
            $table->timestamp('disabled_at')->nullable()->after('auto_join');

            // The org chat is looked up by flag on nearly every page load.
            $table->index(['is_default', 'disabled_at']);
            $table->index('auto_join');
        });
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->dropIndex(['is_default', 'disabled_at']);
            $table->dropIndex(['auto_join']);
            $table->dropColumn(['description', 'is_default', 'auto_join', 'disabled_at']);
        });
    }
};
