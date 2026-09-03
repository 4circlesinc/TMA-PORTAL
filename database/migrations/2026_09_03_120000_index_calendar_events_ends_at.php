<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The grid's single-event query is an overlap test - starts_at < window end
 * AND ends_at > window start - and ends_at had no index, so the second half
 * scanned. Recurrence-window pruning on detached occurrences filters on
 * recurrence_starts_at, which rides the series_id index well enough; ends_at
 * is the one the planner had nothing for.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->index('ends_at');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->dropIndex(['ends_at']);
        });
    }
};
