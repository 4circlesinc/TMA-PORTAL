<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * How many children a synced FOLDER holds, straight from Graph.
     *
     * This is the only way to know how big a library is while it is still
     * importing. Graph has no recursive total: `$count` is rejected outright
     * ("$count is not supported on this API"), the list facet carries no item
     * count, and `/root` reports `childCount` for its DIRECT children only —
     * 50, for a library holding thousands.
     *
     * But every item has exactly one parent, so summing `childCount` across
     * every folder discovered gives the exact total once discovery finishes,
     * and a rising lower bound before then. Delta already returns the number on
     * each folder, so this costs no extra calls — it just stores what was being
     * thrown away, and stores it PER FOLDER so a re-sync of one folder cannot
     * double-count.
     */
    public function up(): void
    {
        Schema::table('sharepoint_items', function (Blueprint $table) {
            $table->unsignedInteger('child_count')->nullable()->after('item_type');
        });
    }

    public function down(): void
    {
        Schema::table('sharepoint_items', function (Blueprint $table) {
            $table->dropColumn('child_count');
        });
    }
};
