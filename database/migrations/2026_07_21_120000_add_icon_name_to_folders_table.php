<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The official icon for default/system folders — admin-set, applies to
     * every viewer, same rule as folders.colour. Regular user folders never
     * write this column; their icon is a personal preference, stored per
     * viewer in folder_colour_preferences instead.
     */
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->string('icon_name', 40)->nullable()->after('colour');
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn('icon_name');
        });
    }
};
