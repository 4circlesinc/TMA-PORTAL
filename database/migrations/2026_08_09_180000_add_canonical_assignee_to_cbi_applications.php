<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One spelling of each assignee, beside the one Smartsheet sent.
     *
     * `assigned_to` stays exactly as imported — it is what the sheet says, and
     * overwriting it would destroy the evidence the matching is based on and
     * be undone by the next sync anyway. The canonical name sits next to it
     * and is what the portal groups, filters and displays by, so one person
     * stops appearing three times in the Assigned filter.
     */
    public function up(): void
    {
        Schema::table('cbi_applications', function (Blueprint $table) {
            $table->string('assigned_to_canonical', 191)->nullable()->after('assigned_to')->index();
        });
    }

    public function down(): void
    {
        Schema::table('cbi_applications', function (Blueprint $table) {
            $table->dropIndex(['assigned_to_canonical']);
            $table->dropColumn('assigned_to_canonical');
        });
    }
};
