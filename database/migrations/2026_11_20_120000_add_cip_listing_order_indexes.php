<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The applications table opens newest-first, scoped to one firm.
     *
     * `provider_id` was indexed with `status`, so a firm's first page could
     * use that index and then sort. Newest-first is `id`, and a branch is
     * `location_id`. A lane tab is phase and status inside the firm. Each
     * of those is an equality followed by `id`, which is the order the page
     * asks for.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->index(['provider_id', 'id'], 'cip_applications_provider_id_id_index');
            $table->index(['location_id', 'id'], 'cip_applications_location_id_id_index');
            $table->index(['provider_id', 'phase', 'status'], 'cip_applications_provider_phase_status_index');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropIndex('cip_applications_provider_id_id_index');
            $table->dropIndex('cip_applications_location_id_id_index');
            $table->dropIndex('cip_applications_provider_phase_status_index');
        });
    }
};
