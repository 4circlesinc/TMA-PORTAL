<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The calendar's audit trail: who did what, to which calendar or event,
     * and when.
     *
     * Rows outlive what they describe — a deleted event's history is exactly
     * what an audit is for — so the subject is recorded by id *and* by name.
     * The foreign keys null out on delete rather than cascading, leaving the
     * record readable after the thing it refers to is gone.
     */
    public function up(): void
    {
        Schema::create('calendar_audit_events', function (Blueprint $table) {
            $table->id();

            // calendar.created, calendar.shared, permission.changed,
            // calendar.connected, event.created, event.moved, ics.imported,
            // sync.failed … see App\Support\Calendar\CalendarAudit.
            $table->string('action', 48);

            /*
             * Null for something the system did on its own — a scheduled sync,
             * a subscription refresh. The actor name is copied in so the row
             * still reads correctly if the account is later removed.
             */
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('actor_name')->nullable();

            $table->foreignId('calendar_id')->nullable()->constrained('calendars')->nullOnDelete();
            $table->string('calendar_name')->nullable();

            $table->foreignId('event_id')->nullable()->constrained('calendar_events')->nullOnDelete();
            $table->string('event_title')->nullable();

            // What changed, or why it failed. Free-form per action.
            $table->jsonb('context')->nullable();

            $table->timestampTz('created_at')->nullable();

            // The two questions asked of an audit: "what happened to this
            // calendar?" and "what has this person been doing?".
            $table->index(['calendar_id', 'created_at']);
            $table->index(['actor_id', 'created_at']);
            $table->index('action');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_audit_events');
    }
};
