<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The author may correct a file message for a short while after sending it.
 * The clock starts when the message was written, and this column records
 * that a correction was made.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_application_messages', function (Blueprint $table) {
            $table->timestamp('edited_at')->nullable()->after('body');
        });
    }

    public function down(): void
    {
        Schema::table('cip_application_messages', function (Blueprint $table) {
            $table->dropColumn('edited_at');
        });
    }
};
