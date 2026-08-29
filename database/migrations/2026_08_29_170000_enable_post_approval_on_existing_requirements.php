<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Post-approval checklists were empty because every seeded requirement
     * lived in pre-approval only. Mirror pre-approval requirements into the
     * post-approval lane so each person’s checklist follows settings until an
     * administrator turns a requirement off for that phase.
     */
    public function up(): void
    {
        DB::table('cip_document_requirements')
            ->where('at_pre_approval', true)
            ->where('at_post_approval', false)
            ->update(['at_post_approval' => true]);
    }

    public function down(): void
    {
        // Cannot safely distinguish mirrored rows from ones an admin set by hand.
    }
};
