<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Detecting — and surviving — an event edited on both sides at once.
     *
     * Section 26 of the brief: the losing version must not be silently
     * discarded. `conflict_snapshot` holds the version that did not win, so
     * the user can see what was overwritten and put it back. It is only ever
     * set when a genuine divergence is found, so a null column is the normal
     * state and costs nothing.
     */
    public function up(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            /*
             * The local revision at the moment we last agreed with the
             * provider. Compared against `updated_at` to answer "has this
             * changed locally since we last pushed or pulled?" — which is the
             * half of conflict detection the provider's etag cannot give us.
             */
            $table->timestampTz('external_synced_local_at')->nullable()->after('external_synced_at');

            /*
             * The content fingerprint at the moment we last agreed with the
             * provider. "Has this changed locally?" is answered by comparing
             * the event's current fingerprint to this — which, unlike a
             * timestamp comparison, is immune to clock precision. An edit and
             * a sync in the same second would otherwise read as no change and
             * silently lose the edit, which is exactly what the brief forbids.
             */
            $table->string('external_local_fingerprint', 64)->nullable()->after('external_synced_local_at');

            // The discarded version, kept so nothing is lost silently.
            $table->jsonb('conflict_snapshot')->nullable()->after('external_synced_local_at');
            $table->timestampTz('conflict_at')->nullable()->after('conflict_snapshot');

            // Cheap lookup for "show me what needs attention".
            $table->index('conflict_at');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->dropIndex(['conflict_at']);
            $table->dropColumn(['external_synced_local_at', 'conflict_snapshot', 'conflict_at']);
        });
    }
};
