<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A reply on the file thread points at the message it answers.
 *
 * Nullable, and cleared if that message is ever removed, so a reply keeps
 * its own words when the original is gone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_application_messages', function (Blueprint $table) {
            $table->foreignId('reply_to_id')
                ->nullable()
                ->after('lane')
                ->constrained('cip_application_messages')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_application_messages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('reply_to_id');
        });
    }
};
