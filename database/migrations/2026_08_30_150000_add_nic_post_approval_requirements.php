<?php

use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stage 2 NIC document requirements, and a female-only flag the
     * checklist reads from Settings (death certificate).
     */
    public function up(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->boolean('female_only')->default(false)->after('real_estate_only');
        });

        (new CipDocumentRequirementSeeder)->syncPostApproval();
    }

    public function down(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->dropColumn('female_only');
        });
    }
};
