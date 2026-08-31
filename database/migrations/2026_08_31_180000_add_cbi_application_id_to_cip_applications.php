<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Idempotency key for the Smartsheet / CBI → CIP cutover (Phase 11c).
     *
     * One CBI mirror row becomes one native application. Re-running the
     * migrator must not mint a second number for a file that already landed.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->foreignId('cbi_application_id')
                ->nullable()
                ->unique()
                ->after('client_id')
                ->constrained('cbi_applications')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cbi_application_id');
        });
    }
};
