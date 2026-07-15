<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('folder_id')->nullable()->constrained('folders')->nullOnDelete();
            $table->string('name');
            $table->string('extension', 32)->nullable();
            $table->string('mime_type', 191)->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->string('disk', 32)->default('local');
            $table->string('storage_path');
            $table->string('checksum', 64)->nullable();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('uploaded_by')->constrained('users')->cascadeOnDelete();
            $table->timestamp('source_modified_at')->nullable();
            $table->softDeletes();
            $table->foreignId('deleted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index('folder_id');
            $table->index('owner_id');
            $table->index('deleted_at');
            $table->index('extension');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('files');
    }
};
