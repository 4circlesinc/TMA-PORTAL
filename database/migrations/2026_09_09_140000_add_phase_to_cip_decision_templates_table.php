<?php

use App\Support\Cip\Phase;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Section 23's letters, split by lane.
 *
 * Approved and Denied mean the same two things in both lanes, but they are
 * not the same letter: a pre-approval grant is the Unit's decision on the
 * application, and a post-approval one lands on a file that has been through
 * COR, NIC and the passport office. The firm writes to those readers
 * differently, so the pair is kept per phase — twenty rows, not ten.
 *
 * Every row that exists today is pre-approval: that is the only lane that
 * could decide anything when they were written. They keep their wording,
 * including whatever the firm has already reworded, and the post-approval
 * half is added from the shipped defaults.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_decision_templates', function (Blueprint $table) {
            $table->string('phase', 24)->default(Phase::PRE_APPROVAL)->after('investment_type');
        });

        // Stamp what is already there before the key changes under it.
        DB::table('cip_decision_templates')->update(['phase' => Phase::PRE_APPROVAL]);

        Schema::table('cip_decision_templates', function (Blueprint $table) {
            $table->dropUnique(['investment_type', 'decision']);
            $table->unique(['investment_type', 'phase', 'decision']);
        });

        // The post-approval half, from the shipped copy. Letters::ensure()
        // does the same thing on every admin listing; doing it here means the
        // rows exist the moment the column does.
        \App\Support\Cip\Letters::ensure();
    }

    public function down(): void
    {
        DB::table('cip_decision_templates')->where('phase', Phase::POST_APPROVAL)->delete();

        Schema::table('cip_decision_templates', function (Blueprint $table) {
            $table->dropUnique(['investment_type', 'phase', 'decision']);
            $table->unique(['investment_type', 'decision']);
            $table->dropColumn('phase');
        });
    }
};
