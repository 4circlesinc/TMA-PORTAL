<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The day the Unit asked for more during a background check.
 *
 * Separate from `query_received_at`: that date belongs to a compliance query
 * and Non-compliant. A file can have passed compliance, then be asked for
 * more during due diligence, and both days have to stay on the record.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->date('dd_query_received_at')->nullable()->after('query_received_at');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('dd_query_received_at');
        });
    }
};
