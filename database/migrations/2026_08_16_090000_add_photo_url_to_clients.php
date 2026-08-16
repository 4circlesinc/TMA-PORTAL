<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The client's face, beside the initials it replaces.
 *
 * A column rather than a key in `data`, for the same reason `initial` and
 * `initial_color` are columns: the directory listing draws an avatar per row
 * and selects a lean set of columns precisely so it never loads eleven
 * thousand profile blobs — which is what put the container out of memory once
 * already. A short URL costs nothing to select; the blob costs everything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->string('photo_url', 255)->nullable()->after('initial_color');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropColumn('photo_url');
        });
    }
};
