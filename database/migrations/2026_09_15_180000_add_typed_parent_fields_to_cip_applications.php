<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * What the agent typed to name an Add-On's parent, kept as typed.
     *
     * The link itself is parent_application_id, and that is still the
     * authority whenever the numbers resolve to a file in the portal. But
     * the match is optional by design: an agent may name a parent the
     * portal has never seen. Until now those three answers were handed to
     * the lookup and, when it found nothing, dropped — the row saved, and
     * reopening it painted three empty boxes over answers that had been
     * given. These columns hold the typed text so the form can put it back.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->string('parent_cip_number', 191)->nullable()->after('parent_application_id');
            $table->string('parent_cor_number', 64)->nullable()->after('parent_cip_number');
            $table->string('parent_applicant_name', 191)->nullable()->after('parent_cor_number');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn([
                'parent_cip_number',
                'parent_cor_number',
                'parent_applicant_name',
            ]);
        });
    }
};
