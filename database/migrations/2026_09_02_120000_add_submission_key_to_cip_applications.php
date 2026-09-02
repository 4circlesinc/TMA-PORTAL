<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One key per form submission, minted by the wizard when it opens.
 *
 * A gateway timeout reads as failure in the browser while the insert
 * commits behind it, so "try again" was minting a second numbered
 * application for the same person. The key lets a retry find the row its
 * first attempt already created; the unique index makes two concurrent
 * lands of the same submission impossible rather than unlikely.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->string('submission_key', 64)->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('submission_key');
        });
    }
};
