<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The provider sync looks every remote event up by
 * (calendar_id, external_event_id) - two to three times per event per run -
 * and the only index carrying external_event_id is the partial unique on
 * (external_provider, external_calendar_id, external_event_id,
 * external_recurrence_id), which doesn't lead with calendar_id and so never
 * serves these lookups.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->index(['calendar_id', 'external_event_id']);
        });
    }

    public function down(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->dropIndex(['calendar_id', 'external_event_id']);
        });
    }
};
