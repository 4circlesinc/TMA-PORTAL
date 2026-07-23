<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Sync state for calendars fed by an external ICS URL.
     *
     * `subscription_url` already exists; this is what the refresh needs to run
     * on a schedule and to report itself honestly in the sidebar — when it
     * last succeeded, whether it is currently failing, and why.
     *
     * The same columns carry Google and Microsoft sync in the next phase; they
     * are named for the concern (subscription/refresh) rather than for ICS.
     */
    public function up(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            // How often to refresh, in minutes. Null = manual only.
            $table->unsignedInteger('subscription_frequency')->nullable()->after('subscription_url');

            // ok | syncing | error | disabled
            $table->string('subscription_status', 16)->nullable()->after('subscription_frequency');
            $table->text('subscription_error')->nullable()->after('subscription_status');

            $table->timestampTz('subscription_synced_at')->nullable()->after('subscription_error');
            $table->timestampTz('subscription_attempted_at')->nullable()->after('subscription_synced_at');

            /*
             * The last ETag/Last-Modified seen, so a refresh can ask the
             * server "has this changed?" and be told 304 rather than
             * re-downloading and re-diffing an unchanged file every hour.
             */
            $table->string('subscription_etag', 255)->nullable()->after('subscription_attempted_at');

            // Consecutive failures, so a permanently dead URL backs off
            // instead of being retried on every scheduler tick forever.
            $table->unsignedInteger('subscription_failures')->default(0)->after('subscription_etag');

            // The scheduler's query: due subscriptions, oldest first.
            $table->index(['source', 'subscription_synced_at']);
        });
    }

    public function down(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            $table->dropIndex(['source', 'subscription_synced_at']);
            $table->dropColumn([
                'subscription_frequency', 'subscription_status', 'subscription_error',
                'subscription_synced_at', 'subscription_attempted_at',
                'subscription_etag', 'subscription_failures',
            ]);
        });
    }
};
