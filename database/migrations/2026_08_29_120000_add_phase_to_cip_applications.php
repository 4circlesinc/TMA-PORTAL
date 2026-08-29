<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Pre-approval vs post-approval workflow lane on one application row.
     *
     * Every existing application stays in pre_approval until an employee
     * manually moves it (or a post-approval intake creates one directly).
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->string('phase', 24)->default('pre_approval')->index()->after('status');
            $table->timestamp('post_approval_at')->nullable()->after('phase');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn(['phase', 'post_approval_at']);
        });
    }
};
