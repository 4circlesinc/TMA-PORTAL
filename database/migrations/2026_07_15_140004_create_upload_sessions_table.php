<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('upload_sessions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('folder_id')->nullable()->constrained('folders')->nullOnDelete();
            $table->string('filename');
            $table->unsignedBigInteger('size')->default(0);
            $table->string('mime_declared', 191)->nullable();
            $table->unsignedBigInteger('chunk_size')->default(0);
            $table->unsignedInteger('total_chunks')->default(0);
            $table->unsignedInteger('received_count')->default(0);
            $table->string('checksum', 64)->nullable();
            // pending | uploading | processing | completed | failed | cancelled
            $table->string('status', 16)->default('pending');
            $table->string('temp_path');
            $table->string('conflict', 16)->nullable(); // replace | keep-both | rename
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index('user_id');
            $table->index('status');
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('upload_sessions');
    }
};
