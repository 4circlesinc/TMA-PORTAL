<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Administrator-managed File Library configuration - a single settings
     * row. Holds the default client subfolders auto-created for every new
     * client, and whether a personal folder is created for new staff.
     */
    public function up(): void
    {
        Schema::create('file_library_settings', function (Blueprint $table) {
            $table->id();
            // { "clientSubfolders": ["Documents","Contracts",...],
            //   "autoCreateStaffFolder": false }
            $table->jsonb('settings');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_library_settings');
    }
};
