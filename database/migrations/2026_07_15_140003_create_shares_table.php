<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shares', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('token', 64)->unique();
            $table->string('item_type', 16); // 'file' | 'folder'
            $table->unsignedBigInteger('item_id');
            $table->foreignId('shared_by')->constrained('users')->cascadeOnDelete();
            $table->string('kind', 16); // 'link' | 'user' | 'email'
            $table->foreignId('target_user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->string('target_email')->nullable();
            $table->string('role', 16)->default('viewer'); // viewer | downloader | editor | full
            $table->jsonb('capabilities')->nullable();
            $table->boolean('allow_download')->default(true);
            $table->string('password_hash')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->index(['item_type', 'item_id']);
            $table->index('shared_by');
            $table->index('target_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shares');
    }
};
