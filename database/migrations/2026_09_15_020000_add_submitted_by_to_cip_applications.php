<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add-On section 15 records who sent the package when the firm records
     * submission. Pre-approval already had the CIP number as its submission
     * fingerprint; Add-On keeps its AO reference and needs a named submitter
     * beside the day.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->string('submitted_by', 191)->nullable()->after('submitted_at');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('submitted_by');
        });
    }
};
