<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-connection pause. The global OneDrive switch in Background Operations
 * pauses every personal drive at once; this lets one owner pause just their
 * own without touching anybody else's.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->timestamp('paused_at')->nullable()->after('sync_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->dropColumn('paused_at');
        });
    }
};
