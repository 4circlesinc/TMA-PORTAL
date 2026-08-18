<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A comment can point at the part of the document it is about.
 *
 * The anchor is a normalised rectangle — page, then x/y/w/h as fractions of
 * the rendered media — written when the author highlighted an area before
 * commenting and null for the ordinary kind. Fractions rather than pixels so
 * the same anchor lands on the same words at any zoom, on any screen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('file_comments', function (Blueprint $table) {
            $table->json('anchor')->nullable()->after('body');
        });
    }

    public function down(): void
    {
        Schema::table('file_comments', function (Blueprint $table) {
            $table->dropColumn('anchor');
        });
    }
};
