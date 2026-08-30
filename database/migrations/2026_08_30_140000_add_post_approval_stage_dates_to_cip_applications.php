<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Dates that drive post-approval status (brief §6–§12).
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->date('cor_submitted_at')->nullable()->after('cor_locked_at');
            $table->date('cor_received_at')->nullable()->after('cor_submitted_at');
            $table->date('nic_submitted_at')->nullable()->after('cor_received_at');
            $table->date('nic_received_at')->nullable()->after('nic_submitted_at');
            $table->date('passport_submitted_at')->nullable()->after('nic_received_at');
            $table->date('passport_received_at')->nullable()->after('passport_submitted_at');
            $table->date('passport_delivered_at')->nullable()->after('passport_received_at');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn([
                'cor_submitted_at',
                'cor_received_at',
                'nic_submitted_at',
                'nic_received_at',
                'passport_submitted_at',
                'passport_received_at',
                'passport_delivered_at',
            ]);
        });
    }
};
