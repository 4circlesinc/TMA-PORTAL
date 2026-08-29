<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-person workflow status in the post-approval lane.
     *
     * Each family member progresses independently after approval; the
     * application-level status stays at Granted while these track where
     * each person is in post-approval.
     */
    public function up(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->string('post_approval_status', 32)->nullable()->after('folder_id');
        });
    }

    public function down(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->dropColumn('post_approval_status');
        });
    }
};
