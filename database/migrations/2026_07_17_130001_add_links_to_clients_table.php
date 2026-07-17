<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Link a CRM client to (1) a login account and (2) its main folder.
     *
     * `folder_id` is the permanent relationship the spec asks for: files are
     * found through the id, never the folder name, so a rename or a duplicate
     * name never loses the connection. `user_id` is the portal account a
     * client signs in with - only content shared with that account is visible
     * to the client.
     */
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->after('uid')
                ->constrained('users')->nullOnDelete();
            $table->foreignId('folder_id')->nullable()->after('user_id')
                ->constrained('folders')->nullOnDelete();

            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropConstrainedForeignId('user_id');
            $table->dropConstrainedForeignId('folder_id');
        });
    }
};
