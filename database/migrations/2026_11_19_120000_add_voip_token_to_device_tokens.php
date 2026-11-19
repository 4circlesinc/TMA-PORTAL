<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * An iPhone's second push token: the VoIP one (PushKit). A call sent to it
 * wakes the app, even when it was closed, straight into the phone's own
 * incoming-call screen (CallKit), the way a phone call or a WhatsApp call
 * rings. The ordinary token on the same row keeps carrying everything else.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->string('voip_token', 512)->nullable()->after('token')->index();
        });
    }

    public function down(): void
    {
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->dropIndex(['voip_token']);
            $table->dropColumn('voip_token');
        });
    }
};
