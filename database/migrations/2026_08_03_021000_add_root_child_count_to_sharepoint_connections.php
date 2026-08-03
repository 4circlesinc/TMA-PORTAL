<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The root folder's own child count.
     *
     * The library total is the sum of every folder's childCount, but the ROOT
     * is deliberately never given a `sharepoint_items` mapping — it is the
     * connection's own portal folder, not an item inside it. That exclusion
     * quietly dropped every file sitting at the top level of the library out of
     * the total, so a library with 200 loose files at its root reported a total
     * 200 short and the panel could show more items imported than exist.
     *
     * It belongs on the connection because that is where the root lives.
     */
    public function up(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->unsignedInteger('root_child_count')->nullable()->after('root_path');
        });
    }

    public function down(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->dropColumn('root_child_count');
        });
    }
};
