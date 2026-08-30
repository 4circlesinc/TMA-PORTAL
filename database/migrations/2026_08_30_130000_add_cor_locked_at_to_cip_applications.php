<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Confirm submission on Apply for COR freezes the Certificate of
     * Registration package without touching the original pre-approval lock.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->timestamp('cor_locked_at')->nullable()->after('locked_at');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('cor_locked_at');
        });
    }
};
