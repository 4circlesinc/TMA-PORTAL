<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The official colour for default/system folders (root, organization,
     * client, staff) — admin-set, applies to every viewer. Regular user
     * folders never write this column; their colour is a personal
     * preference, stored per-viewer in folder_colour_preferences instead.
     */
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->string('colour', 20)->nullable()->after('folder_type');
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn('colour');
        });
    }
};
