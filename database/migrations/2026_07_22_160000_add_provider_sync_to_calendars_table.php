<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-calendar settings for Google and Microsoft sync.
     *
     * The subscription_* columns added for ICS already carry status, error,
     * last-synced and failure count — they were named for the concern rather
     * than for ICS precisely so provider sync could reuse them. What is new
     * here is direction (a subscription is always one-way) and the provider's
     * own incremental cursor.
     */
    public function up(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            /*
             * two_way | import | export.
             *
             * Deliberately per calendar, not per account: someone may want
             * their work diary pulled in read-only while a project calendar
             * they own is pushed out.
             */
            $table->string('sync_direction', 16)->default('two_way')->after('subscription_failures');

            /*
             * The provider's incremental token — Google's syncToken, Graph's
             * deltaLink. Opaque to us and provider-specific; a full re-sync is
             * the recovery when it expires.
             */
            $table->text('sync_cursor')->nullable()->after('sync_direction');

            // How far back the first import reached, so the UI can say so and
            // a widened window can be detected.
            $table->timestampTz('sync_window_start')->nullable()->after('sync_cursor');

            // Whether cancelled/declined events are mirrored at all.
            $table->boolean('sync_cancelled')->default(false)->after('sync_window_start');

            $table->index(['connected_account_id', 'sync_direction']);
        });
    }

    public function down(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            $table->dropIndex(['connected_account_id', 'sync_direction']);
            $table->dropColumn(['sync_direction', 'sync_cursor', 'sync_window_start', 'sync_cancelled']);
        });
    }
};
