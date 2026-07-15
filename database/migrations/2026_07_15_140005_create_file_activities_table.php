<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('item_type', 16); // 'file' | 'folder'
            $table->unsignedBigInteger('item_id');
            // upload|download|preview|rename|move|copy|share|assign|delete|restore|purge|permission
            $table->string('action', 24);
            $table->jsonb('meta')->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['item_type', 'item_id']);
            $table->index('user_id');
            $table->index('action');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_activities');
    }
};
