<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "Sponsored (Yes / No)" is one of the main applicant's mandatory answers
     * (§2), and it decides whether the application carries a sponsor at all
     * (§4). A sponsor row is the consequence, not the answer: an application
     * can be marked sponsored the moment the wizard asks, before anybody has
     * typed the sponsor's name, so the two are stored separately.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->boolean('sponsored')->default(false)->after('investment_type_other');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('sponsored');
        });
    }
};
