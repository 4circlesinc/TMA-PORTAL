<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CIP reports (§25) need to remember more than a type and a window.
 *
 * The existing columns already name the date range. Status, service provider,
 * investment type, applicant, assigned officer, submission date and decision
 * date ride in `filters` so a stored report is still a complete question —
 * re-running it next month asks the same thing of a later caseload.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reports', function (Blueprint $table) {
            $table->jsonb('filters')->nullable()->after('type');
        });
    }

    public function down(): void
    {
        Schema::table('reports', function (Blueprint $table) {
            $table->dropColumn('filters');
        });
    }
};
