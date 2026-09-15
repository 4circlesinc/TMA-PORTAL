<?php

use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add-On is a third Document Requirements lane, not a reuse of Pre.
 *
 * Section 5 of the Add-On brief asks for a checklist that follows the
 * selected type (spouse, dependent under 16, dependent 16 and over) and
 * for G1–G3 supplemental papers in Additional Documents. The Pre column
 * already holds near-identical spouse and dependent lists; a separate
 * tick is what lets an administrator show a paper on one lane and not
 * the other without a deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->boolean('at_add_on')->default(false)->after('at_post_approval');
        });

        $seeder = new CipDocumentRequirementSeeder;
        $seeder->syncAddOn();
    }

    public function down(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->dropColumn('at_add_on');
        });
    }
};
