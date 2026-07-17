<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('folder_shortcuts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // Purging a folder drops the shortcut with it; a soft-deleted folder
            // keeps its row and is filtered out of the listing instead.
            $table->foreignId('folder_id')->constrained('folders')->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            // One shortcut per folder per user — duplicates can't be created.
            $table->unique(['user_id', 'folder_id']);
            $table->index(['user_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('folder_shortcuts');
    }
};
