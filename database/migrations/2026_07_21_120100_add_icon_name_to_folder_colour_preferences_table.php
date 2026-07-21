<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A viewer's personal icon choice for a regular (user-type) folder,
     * alongside the existing personal colour choice on the same row. A row
     * can now meaningfully hold just an icon with no colour override (or
     * vice versa), so `colour` - originally required - becomes nullable too.
     */
    public function up(): void
    {
        Schema::table('folder_colour_preferences', function (Blueprint $table) {
            $table->string('icon_name', 40)->nullable()->after('colour');
            $table->string('colour', 20)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('folder_colour_preferences', function (Blueprint $table) {
            $table->dropColumn('icon_name');
            $table->string('colour', 20)->nullable(false)->change();
        });
    }
};
