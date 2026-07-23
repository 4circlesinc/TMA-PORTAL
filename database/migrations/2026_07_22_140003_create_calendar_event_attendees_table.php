<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Who is invited to an event, and what they said.
     *
     * An attendee is one of three things: a portal user, a whole group, or a
     * bare email address (a client contact or an external guest who has no
     * login). Group rows are kept as the group — not expanded into one row per
     * member — so that inviting Marketing and later adding someone to
     * Marketing does the obvious thing, and so the organizer sees "Marketing"
     * rather than a wall of names. Expansion happens at read time.
     *
     * `response` uses the iCalendar PARTSTAT vocabulary so it maps onto
     * Google and Microsoft without translation in the sync phase.
     */
    public function up(): void
    {
        Schema::create('calendar_event_attendees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained('calendar_events')->cascadeOnDelete();

            // user | group | email
            $table->string('attendee_type', 16)->default('user');
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignId('group_id')->nullable()->constrained('groups')->cascadeOnDelete();
            $table->string('email')->nullable();
            $table->string('name')->nullable();

            // needs_action | accepted | tentative | declined
            $table->string('response', 16)->default('needs_action');
            $table->timestampTz('responded_at')->nullable();

            // Optional attendees don't count against "is everyone free?".
            $table->boolean('is_optional')->default(false);

            // When the invitation actually went out, so a re-send or a change
            // notice can tell "never told" from "told, then changed".
            $table->timestampTz('notified_at')->nullable();

            $table->timestamps();

            // One row per invitee per event. Nulls compare as distinct, so a
            // user row never collides with a group or email row.
            $table->unique(['event_id', 'user_id']);
            $table->unique(['event_id', 'group_id']);
            $table->unique(['event_id', 'email']);
            $table->index('user_id');
            $table->index('group_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_event_attendees');
    }
};
