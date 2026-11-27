<?php

use App\Support\Companies\CompanyMerge;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Log;

return new class extends Migration
{
    /**
     * A merge into a firm whose only provider row had been binned by the
     * 2026-09-24 register clean-up moved that firm's applications onto the
     * binned row: they read as having no service provider. Put them back on
     * a live one. Safe to run again; a second pass finds nothing.
     */
    public function up(): void
    {
        $result = CompanyMerge::repairStranded();

        Log::info('cip: applications stranded by provider merges', $result);
    }

    public function down(): void
    {
        //
    }
};
