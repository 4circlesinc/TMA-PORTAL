<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Groundwork for moving portal applications into the TMA CIP
     * Applications Portal site, without losing the copies already in
     * Microsoft.
     *
     *  - `sharepoint_items.failed_direction` — whether a FAILED row failed on
     *    the way in (pull) or out (push). One status for both made the retry
     *    sweep push a stale portal copy over a SharePoint edit whose download
     *    had merely blipped.
     *  - `sharepoint_items.archived_at` — the old copy of a folder that moved
     *    to another library. The row keeps its Graph id, so the inbound sync
     *    still recognises the item and leaves it alone, but it no longer
     *    points at a portal row: edits to the archive never reach the portal
     *    and never drag the moved folder back.
     *  - `cip_providers.legacy_folder_id` — the provider's drawer in the old
     *    Citizenship Applications library, kept when `folder_id` moves to the
     *    new site, so historical folders still have a home and a guard.
     */
    public function up(): void
    {
        Schema::table('sharepoint_items', function (Blueprint $table) {
            $table->string('failed_direction', 8)->nullable()->after('failure_count');
            $table->timestamp('archived_at')->nullable()->after('recycled_at');
            $table->index(['connection_id', 'archived_at']);
        });

        Schema::table('cip_providers', function (Blueprint $table) {
            $table->foreignId('legacy_folder_id')->nullable()->after('folder_id')
                ->constrained('folders')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_providers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('legacy_folder_id');
        });

        Schema::table('sharepoint_items', function (Blueprint $table) {
            $table->dropIndex(['connection_id', 'archived_at']);
            $table->dropColumn(['failed_direction', 'archived_at']);
        });
    }
};
