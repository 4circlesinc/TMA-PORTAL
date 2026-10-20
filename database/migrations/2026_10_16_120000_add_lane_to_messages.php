<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A case-thread copy remembers which side of the application it came from.
 *
 * Internal notes and service-provider messages share one group in Messages.
 * The lane is what keeps an internal note off the provider's screen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->string('lane', 16)->nullable()->after('cip_application_message_id');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn('lane');
        });
    }
};
