<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A service-provider message on the file can also live in the case chat.
 *
 * One row here points at the file message it was copied from, so opening
 * the group again cannot file the same words twice. Internal notes are
 * never copied, so this column stays empty for everything else.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->foreignId('cip_application_message_id')
                ->nullable()
                ->unique()
                ->constrained('cip_application_messages')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cip_application_message_id');
        });
    }
};
