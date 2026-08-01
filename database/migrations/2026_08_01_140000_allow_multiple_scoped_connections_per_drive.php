<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One drive can be connected more than once, at different scopes.
     *
     * The original unique key was (site_id, drive_id), which assumed one
     * connection per library. Once a connection could target a SUBFOLDER that
     * became wrong: syncing two folders of the same OneDrive as separate links
     * is a perfectly reasonable thing to want, and the old key rejected it with
     * a raw constraint violation.
     *
     * The scope is now part of the identity.
     */
    public function up(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->dropUnique('sharepoint_connections_site_id_drive_id_unique');
            $table->unique(['site_id', 'drive_id', 'root_item_id'], 'sharepoint_connections_scope_unique');
        });
    }

    public function down(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->dropUnique('sharepoint_connections_scope_unique');
            $table->unique(['site_id', 'drive_id']);
        });
    }
};
