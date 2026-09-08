<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The appeal lane's two recorded days.
 *
 * A decision is not always the end of a file. The day the appeal was lodged
 * and the day it went to the Unit are both real external events with paper
 * behind them, so they are recorded rather than stamped from the clock — the
 * same reasoning as `query_received_at` and `accepted_at`.
 *
 * Appeal ready has no column: it is an internal readiness flag, like Ready to
 * Submit, and the event log already carries when it happened.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->date('appeal_lodged_at')->nullable()->after('decided_at');
            $table->date('appeal_submitted_at')->nullable()->after('appeal_lodged_at');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn(['appeal_lodged_at', 'appeal_submitted_at']);
        });
    }
};
