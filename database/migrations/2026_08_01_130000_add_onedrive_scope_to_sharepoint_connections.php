<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Let a connection point at a OneDrive, and at a SUBFOLDER rather than a
     * whole drive.
     *
     * Scoping matters more here than it does for a document library. A
     * SharePoint library is shared by intent; a personal OneDrive is not, and
     * with firm-wide default access an unscoped import would publish somebody's
     * meeting recordings and auto-saved chat attachments to the whole firm.
     * Connecting one folder is the difference between "our contracts" and
     * "everything I have ever touched".
     */
    public function up(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            // site | onedrive — only affects how the drive was found.
            $table->string('drive_kind', 16)->default('site')->after('drive_name');
            // Whose OneDrive, when drive_kind is onedrive.
            $table->string('owner_upn')->nullable()->after('drive_kind');
            /*
             * The Graph item id to sync FROM. Null means the drive root.
             * Delta works against any folder, so scoping costs nothing.
             */
            $table->string('root_item_id', 256)->nullable()->after('owner_upn');
            $table->string('root_path')->nullable()->after('root_item_id');
        });
    }

    public function down(): void
    {
        Schema::table('sharepoint_connections', function (Blueprint $table) {
            $table->dropColumn(['drive_kind', 'owner_upn', 'root_item_id', 'root_path']);
        });
    }
};
