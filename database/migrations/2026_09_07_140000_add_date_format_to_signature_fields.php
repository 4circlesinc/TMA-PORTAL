<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How a "Date signed" field writes its date.
 *
 * The date was always stamped as "7 Sep 2026" with no say in the matter, which
 * is wrong for any document that states its own convention. Nullable on
 * purpose: null keeps that same format, so every field placed before this
 * renders exactly as it already does.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('signature_fields', function (Blueprint $table) {
            // A key from App\Support\Signatures\DateFormat, never a raw PHP
            // format string - the value reaches the stamper from a public
            // request, and format() would happily run whatever it is given.
            $table->string('date_format', 16)->nullable()->after('align');
        });
    }

    public function down(): void
    {
        Schema::table('signature_fields', function (Blueprint $table) {
            $table->dropColumn('date_format');
        });
    }
};
