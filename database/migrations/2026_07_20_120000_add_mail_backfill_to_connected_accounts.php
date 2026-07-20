<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-folder backfill progress, so pulling a large mailbox's history can be
     * resumed across job runs instead of restarting.
     *
     * Shape: { "inbox": {"token": "<providerPageToken>|null", "done": false}, ... }
     * A folder with done=true is fully backfilled; token is where to resume.
     */
    public function up(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            $table->jsonb('mail_backfill')->nullable()->after('mail_error');
            $table->timestamp('mail_backfilled_at')->nullable()->after('mail_backfill');
        });
    }

    public function down(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            $table->dropColumn(['mail_backfill', 'mail_backfilled_at']);
        });
    }
};
