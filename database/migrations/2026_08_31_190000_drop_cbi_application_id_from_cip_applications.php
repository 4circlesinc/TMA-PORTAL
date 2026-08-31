<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * CIP applications are not a Smartsheet/CBI import. Drops the cutover
     * column on databases that already received it.
     */
    public function up(): void
    {
        if (! Schema::hasColumn('cip_applications', 'cbi_application_id')) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();

        Schema::table('cip_applications', function (Blueprint $table) use ($driver) {
            if ($driver === 'pgsql') {
                $table->dropConstrainedForeignId('cbi_application_id');

                return;
            }

            $table->dropUnique(['cbi_application_id']);
        });

        if ($driver === 'pgsql') {
            return;
        }

        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('cbi_application_id');
        });
    }

    public function down(): void
    {
        // Not restored. CIP applications do not point at the CBI mirror.
    }
};
