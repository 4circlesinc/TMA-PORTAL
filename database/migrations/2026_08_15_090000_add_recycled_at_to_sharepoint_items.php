<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A recycled item keeps its mapping.
     *
     * The mapping row used to be destroyed when an item was deleted in
     * SharePoint, which threw away the only link between the Graph item and the
     * portal row now sitting in the recycle bin. Restoring the item in OneDrive
     * then looked like a brand-new file: the portal imported a second copy and
     * the original stayed in the bin for ever.
     *
     * Keeping the row — flagged rather than deleted — is what lets a restore on
     * either side find its way back to the same file, with its versions,
     * comments and shares intact. It also stops the reconcile pass re-deleting
     * something that is already in the bin.
     */
    public function up(): void
    {
        Schema::table('sharepoint_items', function (Blueprint $table) {
            $table->timestamp('recycled_at')->nullable()->after('last_synced_at');
            $table->index(['connection_id', 'recycled_at']);
        });
    }

    public function down(): void
    {
        Schema::table('sharepoint_items', function (Blueprint $table) {
            $table->dropIndex(['connection_id', 'recycled_at']);
            $table->dropColumn('recycled_at');
        });
    }
};
