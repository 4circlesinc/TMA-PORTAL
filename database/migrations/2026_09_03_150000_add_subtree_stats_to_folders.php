<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Rolled-up subtree stats, refreshed by files:refresh-folder-stats.
 *
 * The listing used to compute these live with a recursive CTE - 5.7s against
 * the production tree (55k folders, 1M files) - and was cut to direct-child
 * counts in the 27 Aug perf pass, which made every folder-of-folders read
 * "0 files, 0 B". Denormalised and refreshed on the scheduler, the listing
 * shows the truth for free and is at most a few minutes stale.
 *
 * Null means "not yet measured" (a fresh deploy, a brand-new folder); the
 * presenter falls back to direct counts until the next refresh.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->unsignedBigInteger('subtree_file_count')->nullable();
            $table->unsignedBigInteger('subtree_folder_count')->nullable();
            $table->unsignedBigInteger('subtree_size')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn(['subtree_file_count', 'subtree_folder_count', 'subtree_size']);
        });
    }
};
