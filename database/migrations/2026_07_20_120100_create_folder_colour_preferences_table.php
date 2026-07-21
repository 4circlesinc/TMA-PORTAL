<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A viewer's personal colour choice for a regular (user-type) folder.
     * Never used for default/system folders — those carry their one
     * official colour directly on folders.colour instead.
     */
    public function up(): void
    {
        Schema::create('folder_colour_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('folder_id')->constrained('folders')->cascadeOnDelete();
            $table->string('colour', 20);
            $table->timestamps();

            $table->unique(['user_id', 'folder_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('folder_colour_preferences');
    }
};
