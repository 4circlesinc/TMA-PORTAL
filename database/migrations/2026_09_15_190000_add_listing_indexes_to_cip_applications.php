<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Indexes for the way the applications table is actually read.
     *
     * Every tab is `where phase = ? and status != ?`, and the columns were
     * indexed one at a time: Postgres could use either, never both, so each
     * tab switch scanned one lane's worth of rows to apply the other test.
     * `submitted_at` is a sort column with no index at all, and `client_id`
     * is joined on every listing to reach the client and their assignments.
     *
     * Composite order is deliberate: phase first because it is always an
     * equality test and the narrower of the two.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->index(['phase', 'status'], 'cip_applications_phase_status_index');
            $table->index('submitted_at', 'cip_applications_submitted_at_index');
            $table->index('client_id', 'cip_applications_client_id_index');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropIndex('cip_applications_phase_status_index');
            $table->dropIndex('cip_applications_submitted_at_index');
            $table->dropIndex('cip_applications_client_id_index');
        });
    }
};
