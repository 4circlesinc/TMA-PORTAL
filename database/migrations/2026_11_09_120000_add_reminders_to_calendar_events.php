<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Personal reminders on calendar entries.
 *
 * A "Reminder" made in the calendar was only an event with that title: it
 * never told anybody anything. Each event can now carry when to remind
 * (minutes before it starts, 0 for at the time), and every reminder sent is
 * written down per occurrence, so a recurring entry reminds once each time
 * and a restart of the scheduler never sends the same one twice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->unsignedInteger('reminder_minutes')->nullable();
        });

        Schema::create('calendar_event_reminders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained('calendar_events')->cascadeOnDelete();
            $table->timestamp('occurrence_at');
            $table->timestamp('sent_at');
            $table->unique(['event_id', 'occurrence_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_event_reminders');

        Schema::table('calendar_events', function (Blueprint $table) {
            $table->dropColumn('reminder_minutes');
        });
    }
};
