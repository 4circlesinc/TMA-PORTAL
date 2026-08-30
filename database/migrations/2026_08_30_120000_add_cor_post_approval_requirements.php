<?php

use App\Models\CipApplication;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stage 1 COR document requirements, and a Real Estate-only flag the
     * checklist reads from Settings rather than from hardcoded form rules.
     *
     * Also moves existing post-approval files off the Approved chip onto
     * Post-Approval, matching brief §1: the reviewer changes the status
     * from Approved to Post Approval.
     */
    public function up(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->boolean('real_estate_only')->default(false)->after('carry_forward');
        });

        (new CipDocumentRequirementSeeder)->syncPostApproval();

        CipApplication::query()
            ->where('phase', Phase::POST_APPROVAL)
            ->where('status', Status::GRANTED)
            ->update(['status' => Status::POST_APPROVAL]);
    }

    public function down(): void
    {
        CipApplication::query()
            ->where('phase', Phase::POST_APPROVAL)
            ->where('status', Status::POST_APPROVAL)
            ->update(['status' => Status::GRANTED]);

        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->dropColumn('real_estate_only');
        });
    }
};
