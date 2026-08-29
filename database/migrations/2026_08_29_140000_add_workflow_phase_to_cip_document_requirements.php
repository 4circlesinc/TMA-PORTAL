<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which workflow lane a requirement belongs to, and whether a pre-approval
     * answer carries into post-approval without re-uploading the file.
     */
    public function up(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->boolean('at_pre_approval')->default(true)->after('required');
            $table->boolean('at_post_approval')->default(false)->after('at_pre_approval');
            $table->boolean('carry_forward')->default(false)->after('at_post_approval');
        });
    }

    public function down(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->dropColumn(['at_pre_approval', 'at_post_approval', 'carry_forward']);
        });
    }
};
