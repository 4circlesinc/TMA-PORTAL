<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('signature_requests', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            // The original document, and the signed copy once completed. Both
            // null on delete so the request and its audit trail outlive either
            // file being removed from the library.
            $table->foreignId('file_id')->nullable()->constrained('files')->nullOnDelete();
            $table->foreignId('signed_file_id')->nullable()->constrained('files')->nullOnDelete();
            // Where the signed copy gets saved (null = same folder as original).
            $table->foreignId('folder_id')->nullable()->constrained('folders')->nullOnDelete();

            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->string('subject')->nullable();
            $table->text('message')->nullable();
            // draft|sent|viewed|in_progress|completed|declined|cancelled|expired
            $table->string('status', 16)->default('draft');
            $table->unsignedSmallInteger('auto_delete_days')->default(30);

            $table->timestamp('expires_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('declined_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->softDeletes();
            $table->timestamps();

            $table->index('created_by');
            $table->index('status');
            $table->index('deleted_at');
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('signature_requests');
    }
};
