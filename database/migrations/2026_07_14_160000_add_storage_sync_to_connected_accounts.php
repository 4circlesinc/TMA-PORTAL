<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            $table->boolean('sync_onedrive')->default(false)->after('sync_calendar');
            $table->boolean('sync_sharepoint')->default(false)->after('sync_onedrive');
        });
    }

    public function down(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table) {
            $table->dropColumn(['sync_onedrive', 'sync_sharepoint']);
        });
    }
};
