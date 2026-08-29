<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->foreignId('post_approval_folder_id')
                ->nullable()
                ->after('folder_id')
                ->constrained('folders')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('post_approval_folder_id');
        });
    }
};
