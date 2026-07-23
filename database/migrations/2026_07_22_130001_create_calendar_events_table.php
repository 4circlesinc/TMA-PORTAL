<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One event on one calendar.
     *
     * Times are stored as absolute instants (timestamptz) so a week grid can
     * be queried with a plain range scan regardless of the viewer's zone. The
     * originating zone is kept alongside in `timezone` because it cannot be
     * recovered from an instant, and both recurrence expansion and ICS export
     * need it: "every Monday at 09:00 Africa/Johannesburg" survives a DST
     * shift only if the rule is evaluated in its own zone.
     *
     * All-day events store midnight-to-midnight in `timezone` and set
     * `all_day`; readers must format from the zone, never from UTC.
     */
    public function up(): void
    {
        Schema::create('calendar_events', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('calendar_id')->constrained('calendars')->cascadeOnDelete();

            $table->string('title');
            $table->text('description')->nullable();
            $table->string('location')->nullable();

            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');
            $table->boolean('all_day')->default(false);
            $table->string('timezone', 64)->default('UTC');

            // confirmed | tentative | cancelled. Cancelled events are kept
            // rather than deleted so a sync can propagate the cancellation.
            $table->string('status', 16)->default('confirmed');
            // default | public | private. 'private' hides details from
            // viewers who only hold availability-level permission.
            $table->string('visibility', 16)->default('default');
            // Per-event override; null means inherit the calendar's colour.
            $table->string('colour', 24)->nullable();

            $table->foreignId('organizer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();

            $table->text('meeting_url')->nullable();

            /*
             * Recurrence. `recurrence_rule` is an RFC 5545 RRULE on the series
             * master. Detached occurrences (a single moved instance) carry
             * `series_id` pointing at the master plus `recurrence_starts_at`,
             * the original start of the instance they replace — which is how
             * "this event only" edits stay attached to their series.
             */
            $table->text('recurrence_rule')->nullable();
            $table->jsonb('recurrence_exdates')->nullable();
            $table->foreignId('series_id')->nullable()->constrained('calendar_events')->cascadeOnDelete();
            $table->timestampTz('recurrence_starts_at')->nullable();

            /*
             * External identity, for duplicate prevention across syncs. The
             * pairing that matters is (provider, external_calendar_id,
             * external_event_id) — never title/date/attendee heuristics.
             * `external_etag` and `external_synced_at` carry the last version
             * seen, which is what conflict detection compares against.
             */
            $table->string('external_provider', 24)->nullable();
            $table->string('external_calendar_id', 512)->nullable();
            $table->string('external_event_id', 512)->nullable();
            $table->string('external_recurrence_id', 512)->nullable();
            $table->string('external_etag', 255)->nullable();
            $table->timestampTz('external_synced_at')->nullable();

            $table->timestampTz('completed_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            // The query every view makes: one calendar, one date window.
            $table->index(['calendar_id', 'starts_at']);
            $table->index('starts_at');
            $table->index('series_id');
            $table->index('client_id');
            $table->index('organizer_id');
            $table->index('deleted_at');
        });

        /*
         * One provider event maps to at most one local event.
         *
         * Partial, so the vast majority of rows (local events, all-null
         * external columns) are exempt rather than colliding. NULLS NOT
         * DISTINCT is the load-bearing part: `external_recurrence_id` is null
         * for every non-recurring event, and under the default NULLS DISTINCT
         * every one of those tuples would be considered unique — which is
         * exactly the duplicate this index exists to prevent.
         */
        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            Schema::getConnection()->statement(
                'CREATE UNIQUE INDEX calendar_events_external_unique
                 ON calendar_events (external_provider, external_calendar_id, external_event_id, external_recurrence_id)
                 NULLS NOT DISTINCT
                 WHERE external_event_id IS NOT NULL'
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_events');
    }
};
