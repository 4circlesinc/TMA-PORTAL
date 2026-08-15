<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The passport-sized photo §2 asks for, on the person it depicts.
 *
 * Two columns because the photo has two jobs and one file cannot do both. The
 * archival copy is what gets filed with the government, so it keeps the
 * resolution it arrived at; the avatar is a 320px square the portal draws in
 * tables and headers, and serving the archival copy there would push a
 * megabyte per row.
 *
 * On the person rather than in the document slots (Phase 2d) because this is
 * the only intake upload that is also a likeness: the bio page and the birth
 * certificate are evidence, this is who the applicant is. The slot can point
 * here when it lands.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->string('photo_path', 255)->nullable()->after('passport_number');
            $table->string('photo_url', 255)->nullable()->after('photo_path');
        });
    }

    public function down(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->dropColumn(['photo_path', 'photo_url']);
        });
    }
};
